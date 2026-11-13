/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { useState, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { useUpdateOption } from '../../hooks/use-update-option'
import { PhoneAuthSection } from '../phone-auth-section'

const defaults = {
  'phone.enabled': false,
  'phone.region': 'cn-hangzhou',
  'phone.sign_name': '',
  'phone.template_code': '',
}
async function renderSettings() {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  function Fixture() {
    const [container, setContainer] = useState<HTMLDivElement | null>(null)
    return (
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <div ref={setContainer} />
          <SettingsPageProvider actionsContainer={container}>
            <PhoneAuthSection defaultValues={defaults} />
          </SettingsPageProvider>
        </QueryClientProvider>
      </I18nextProvider>
    )
  }
  render(<Fixture />)
  return { client, invalidate }
}
beforeEach(() => {
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})
it('saves phone prerequisites before enabling and refreshes public availability', async () => {
  const user = userEvent.setup()
  const { client, invalidate } = await renderSettings()
  window.localStorage.setItem('status', JSON.stringify({ phone_login: false }))
  await user.clear(
    screen.getByRole('textbox', { name: 'Alibaba Cloud region' })
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Alibaba Cloud region' }),
    'cn-shanghai'
  )
  await user.type(
    screen.getByRole('textbox', { name: 'SMS signature name' }),
    'Test signature'
  )
  await user.type(
    screen.getByRole('textbox', { name: 'SMS template code' }),
    'SMS_TEST'
  )
  await user.click(
    screen.getByRole('switch', { name: 'Enable phone verification sign in' })
  )
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(4))
  expect(vi.mocked(api.put).mock.calls.map((call) => call.slice(0, 2))).toEqual(
    [
      ['/api/option/', { key: 'phone.region', value: 'cn-shanghai' }],
      ['/api/option/', { key: 'phone.sign_name', value: 'Test signature' }],
      ['/api/option/', { key: 'phone.template_code', value: 'SMS_TEST' }],
      ['/api/option/', { key: 'phone.enabled', value: true }],
    ]
  )
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['status'] })
  expect(window.localStorage.getItem('status')).toBeNull()
  client.clear()
})

it.each([
  ['phone.enabled', true],
  ['phone.region', 'cn-shanghai'],
  ['phone.sign_name', 'Updated signature'],
  ['phone.template_code', 'SMS_UPDATED'],
] as const)('refreshes status after changing %s', async (key, value) => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  client.setQueryData(['status'], { phone_login: false })
  window.localStorage.setItem('status', 'stale')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useUpdateOption(), { wrapper })
  await act(async () => {
    await result.current.mutateAsync({ key, value })
  })
  expect(client.getQueryState(['status'])?.isInvalidated).toBe(true)
  expect(window.localStorage.getItem('status')).toBeNull()
  client.clear()
})

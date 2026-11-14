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
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { getSiteSectionContent } from '../../site/section-registry'
import type { SiteSettings } from '../../types'

const settings: SiteSettings = {
  Notice: '',
  SystemName: 'Test',
  Logo: '',
  Footer: '',
  About: '',
  HomePageContent: '',
  ServerAddress: '',
  TaskPublicAddress: '',
  'general_setting.docs_link': '',
  'general_setting.support_wecom': 'old-wecom',
  'general_setting.operations_email': 'old@example.com',
  'legal.user_agreement': '',
  'legal.privacy_policy': '',
  HeaderNavModules: '',
  SidebarModulesAdmin: '',
}
function Fixture() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <div ref={setContainer} />
      <SettingsPageProvider actionsContainer={container}>
        {getSiteSectionContent('system-info', settings)}
      </SettingsPageProvider>
    </>
  )
}
async function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(['status'], { support_wecom: 'old-wecom' })
  const router = createRouter({
    routeTree: createRootRoute({ component: Fixture }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('textbox', { name: 'WeCom' })
  return client
}
beforeEach(() => {
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})
it('loads configured contacts and saves edits while invalidating public status', async () => {
  const client = await mount()
  const wecom = screen.getByRole('textbox', { name: 'WeCom' })
  const email = screen.getByRole('textbox', { name: 'Operations Email' })
  expect(wecom).toHaveValue('old-wecom')
  expect(email).toHaveValue('old@example.com')
  fireEvent.change(wecom, { target: { value: 'new-wecom' } })
  fireEvent.change(email, { target: { value: 'new@example.com' } })
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'general_setting.operations_email',
      value: 'new@example.com',
    })
  )
  expect(api.put).toHaveBeenCalledWith('/api/option/', {
    key: 'general_setting.support_wecom',
    value: 'new-wecom',
  })
  expect(client.getQueryState(['status'])?.isInvalidated).toBe(true)
})
it('rejects malformed operations email without saving', async () => {
  await mount()
  const email = screen.getByRole('textbox', { name: 'Operations Email' })
  fireEvent.change(email, { target: { value: 'not-an-email' } })
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'))
  expect(api.put).not.toHaveBeenCalled()
})
it('allows clearing both support contacts', async () => {
  await mount()
  fireEvent.change(screen.getByRole('textbox', { name: 'WeCom' }), {
    target: { value: '' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Operations Email' }), {
    target: { value: '' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'general_setting.operations_email',
      value: '',
    })
  )
  expect(api.put).toHaveBeenCalledWith('/api/option/', {
    key: 'general_setting.support_wecom',
    value: '',
  })
})

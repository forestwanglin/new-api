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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { PhoneAuthForm } from '../phone-auth-form'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
afterEach(() => vi.restoreAllMocks())

it('requires server image verification before sending SMS and resets permission on phone change', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        challenge_token: 'captcha',
        browser_token: 'browser',
        image: 'data:image/png;base64,AA==',
      },
    },
  })
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { send_token: 'permit' } },
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PhoneAuthForm onResult={vi.fn()} enabled />
    </QueryClientProvider>
  )
  const send = screen.getByRole('button', { name: 'Get verification code' })
  expect(send).toBeDisabled()
  const user = userEvent.setup()
  await user.type(
    screen.getByLabelText('Phone number (mainland China +86)'),
    '13800138000'
  )
  await user.type(screen.getByLabelText('Image verification code'), '12345')
  await user.click(screen.getByRole('button', { name: 'Verify image code' }))
  await waitFor(() => expect(send).toBeEnabled())
  await user.clear(screen.getByLabelText('Phone number (mainland China +86)'))
  expect(send).toBeDisabled()
})

it('keeps send disabled when the server rejects the image answer', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        challenge_token: 'captcha',
        browser_token: 'browser',
        image: 'data:image/png;base64,AA==',
      },
    },
  })
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: false, message: 'Wrong image code' },
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PhoneAuthForm onResult={vi.fn()} enabled />
    </QueryClientProvider>
  )
  const user = userEvent.setup()
  await user.type(
    screen.getByLabelText('Phone number (mainland China +86)'),
    '13800138000'
  )
  await user.type(screen.getByLabelText('Image verification code'), '12345')
  await user.click(screen.getByRole('button', { name: 'Verify image code' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Wrong image code')
  expect(
    screen.getByRole('button', { name: 'Get verification code' })
  ).toBeDisabled()
})

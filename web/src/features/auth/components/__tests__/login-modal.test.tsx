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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useLoginModalStore } from '@/stores/login-modal-store'

import { LoginModal } from '../login-modal'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  useNavigate: () => vi.fn(),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}))
vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({
    status: {
      wechat_login: true,
      phone_login: true,
      wechat_qrcode: 'https://example.test/qr.png',
    },
  }),
}))
beforeEach(() => {
  useLoginModalStore.getState().open()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        challenge_token: 'image',
        browser_token: 'browser',
        image: 'data:image/png;base64,AA==',
      },
    },
  })
})
afterEach(() => {
  useLoginModalStore.getState().close()
  vi.restoreAllMocks()
})

it('shows only WeChat and phone tabs and closes with its accessible close button', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LoginModal />
    </QueryClientProvider>
  )
  expect(
    await screen.findByRole('dialog', { name: 'Register / Sign in' })
  ).toBeInTheDocument()
  expect(screen.getAllByRole('tab')).toHaveLength(2)
  expect(screen.queryByRole('tab', { name: /email/i })).not.toBeInTheDocument()
  expect(screen.queryByText(/invitation code/i)).not.toBeInTheDocument()
  expect(
    screen.getByRole('img', { name: 'WeChat login QR code' })
  ).toHaveAttribute('src', 'https://example.test/qr.png')
  await userEvent.click(
    screen.getByRole('button', { name: 'Close sign in dialog' })
  )
  expect(useLoginModalStore.getState().isOpen).toBe(false)
})

it('keeps unbound WeChat users in the WeChat tab and asks for phone verification', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: { require_phone_binding: true, bind_token: 'pending-wechat' },
    },
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LoginModal />
    </QueryClientProvider>
  )
  await userEvent.type(
    await screen.findByLabelText('WeChat verification code'),
    '765432'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(
    await screen.findByText('Bind a phone number to finish WeChat sign in')
  ).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'WeChat QR code' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(useLoginModalStore.getState().isOpen).toBe(true)
  expect(
    screen.getByRole('button', { name: 'Get verification code' })
  ).toBeDisabled()
})

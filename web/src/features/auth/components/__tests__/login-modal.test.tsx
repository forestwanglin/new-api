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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'

import { saveAffiliateCode } from '../../lib/storage'
import { LoginModal } from '../login-modal'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  useNavigate: () => vi.fn(),
}))
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
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
  localStorage.clear()
  useAuthStore.getState().auth.reset()
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
  localStorage.clear()
  useAuthStore.getState().auth.reset()
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

it('keeps unbound WeChat users in the WeChat tab and retains their invitation until phone verification', async () => {
  saveAffiliateCode('iQO5')
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
  expect(localStorage.getItem('aff')).toBe('iQO5')
  expect(
    screen.getByRole('button', { name: 'Get verification code' })
  ).toBeDisabled()
})

const bundle = {
  user: { id: 42, username: 'new-user', role: 1 },
  access_token: 'access',
  token_type: 'Bearer',
  access_expires_at: 9999999999,
  session: {
    sid: 'new-session',
    current: true,
    login_method: 'wechat',
    ip: '127.0.0.1',
    user_agent: 'Browser',
    created_at: 1,
    last_active_at: 1,
    expires_at: 9999999999,
  },
}

it('sends the invitation to WeChat and clears it only after successful authentication', async () => {
  saveAffiliateCode('iQO5')
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: bundle } })
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
  await waitFor(() => expect(useAuthStore.getState().auth.user?.id).toBe(42))
  expect(post).toHaveBeenCalledWith(
    '/api/oauth/wechat',
    { code: '765432', aff: 'iQO5' },
    expect.objectContaining({ headers: { 'X-Phone-Auth': 'browser' } })
  )
  expect(localStorage.getItem('aff')).toBeNull()
})

it('retains the invitation when WeChat verification fails', async () => {
  saveAffiliateCode('iQO5')
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: false, message: 'Invalid code' },
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
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid code')
  expect(localStorage.getItem('aff')).toBe('iQO5')
})

it('keeps a newer invitation when an older login completes', async () => {
  saveAffiliateCode('first')
  vi.spyOn(api, 'post').mockImplementation(async () => {
    saveAffiliateCode('second')
    return { data: { success: true, data: bundle } }
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
  await waitFor(() => expect(useAuthStore.getState().auth.user?.id).toBe(42))
  expect(localStorage.getItem('aff')).toBe('second')
})

it('retains the invitation when the login modal is closed without authentication', async () => {
  saveAffiliateCode('iQO5')
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LoginModal />
    </QueryClientProvider>
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Close sign in dialog' })
  )
  expect(localStorage.getItem('aff')).toBe('iQO5')
  expect(useAuthStore.getState().auth.user).toBeNull()
})

it('uses the latest invitation when a new link is opened before submitting WeChat verification', async () => {
  saveAffiliateCode('first')
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: bundle } })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LoginModal />
    </QueryClientProvider>
  )
  await screen.findByLabelText('WeChat verification code')
  saveAffiliateCode('second')
  await userEvent.type(
    screen.getByLabelText('WeChat verification code'),
    '765432'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() => expect(useAuthStore.getState().auth.user?.id).toBe(42))
  expect(post).toHaveBeenCalledWith(
    '/api/oauth/wechat',
    { code: '765432', aff: 'second' },
    expect.any(Object)
  )
  expect(localStorage.getItem('aff')).toBeNull()
})

it('keeps the original WeChat invitation through phone binding when a newer invitation arrives', async () => {
  saveAffiliateCode('first')
  const post = vi.spyOn(api, 'post').mockImplementation(async (path) => {
    if (path === '/api/oauth/wechat') {
      return {
        data: {
          success: true,
          data: { require_phone_binding: true, bind_token: 'pending-wechat' },
        },
      }
    }
    if (path === '/api/phone/captcha/verify') {
      return { data: { success: true, data: { send_token: 'permit' } } }
    }
    if (path === '/api/phone/sms/send') {
      return {
        data: { success: true, data: { sms_token: 'sms', retry_after: 90 } },
      }
    }
    return { data: { success: true, data: bundle } }
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
  await screen.findByText('Bind a phone number to finish WeChat sign in')
  saveAffiliateCode('second')
  await userEvent.type(
    screen.getByLabelText('Phone number (mainland China +86)'),
    '13800138000'
  )
  await userEvent.type(
    screen.getByLabelText('Image verification code'),
    '12345'
  )
  const send = screen.getByRole('button', { name: 'Get verification code' })
  await waitFor(() => expect(send).toBeEnabled())
  await userEvent.click(send)
  await userEvent.type(screen.getByLabelText('SMS verification code'), '123456')
  await userEvent.click(
    screen.getByRole('button', { name: 'Bind phone and sign in' })
  )
  await waitFor(() => expect(useAuthStore.getState().auth.user?.id).toBe(42))
  expect(post).toHaveBeenCalledWith(
    '/api/phone/captcha/verify',
    expect.objectContaining({ aff: 'first', bind_token: 'pending-wechat' }),
    expect.any(Object)
  )
  expect(localStorage.getItem('aff')).toBe('second')
})

it('retains the invitation during MFA and clears it after the final verification bundle', async () => {
  saveAffiliateCode('iQO5')
  vi.spyOn(api, 'post').mockImplementation(async (path) => {
    if (path === '/api/oauth/wechat') {
      return {
        data: {
          success: true,
          data: {
            require_verification: true,
            flow_token: 'pending-login',
            expires_at: Math.floor(Date.now() / 1000) + 300,
            methods: [{ method: '2fa', available: true }],
          },
        },
      }
    }
    return { data: { success: true, data: bundle } }
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
  const code = await screen.findByLabelText('Authenticator code or backup code')
  expect(localStorage.getItem('aff')).toBe('iQO5')
  expect(useAuthStore.getState().auth.user).toBeNull()
  await userEvent.type(code, '123456')
  await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
  await waitFor(() => expect(useAuthStore.getState().auth.user?.id).toBe(42))
  expect(localStorage.getItem('aff')).toBeNull()
})

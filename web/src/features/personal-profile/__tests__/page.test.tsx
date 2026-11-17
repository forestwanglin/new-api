import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { PersonalProfile } from '../index'

const profile = {
  id: 1,
  username: 'alice',
  display_name: 'Alice',
  role: 1,
  setting: '{}',
}
beforeEach(() => {
  useAuthStore.getState().auth.setUser(profile)
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/status')
        ? {
            bound: true,
            phone_masked: '138****8000',
            verification_required: false,
          }
        : profile,
    },
  }))
})
afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.reset('idle')
  vi.restoreAllMocks()
  void i18next.changeLanguage('en')
})

it('preserves the nickname draft through language saves and syncs later updates after nickname save', async () => {
  let savedProfile = { ...profile }
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/status')
        ? {
            bound: true,
            phone_masked: '138****8000',
            verification_required: false,
          }
        : savedProfile,
    },
  }))
  const put = vi.spyOn(api, 'put').mockImplementation(async (_url, body) => {
    const values = body as { language?: string; display_name?: string }
    savedProfile = {
      ...savedProfile,
      display_name: values.display_name ?? savedProfile.display_name,
      setting: JSON.stringify({ language: values.language ?? 'fr' }),
    }
    return { data: { success: true } }
  })
  const user = userEvent.setup()
  renderProfile()
  const nickname = await screen.findByLabelText('Nickname')
  await user.clear(nickname)
  await user.type(nickname, 'Draft nickname')
  await user.click(screen.getByLabelText('Preferred language'))
  await user.click(await screen.findByRole('option', { name: 'Français' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/user/self', { language: 'fr' })
  )
  await waitFor(() =>
    expect(
      vi.mocked(api.get).mock.calls.filter(([url]) => url === '/api/user/self')
    ).toHaveLength(2)
  )
  expect(nickname).toHaveValue('Draft nickname')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(useAuthStore.getState().auth.user?.display_name).toBe(
      'Draft nickname'
    )
  )
  savedProfile = { ...savedProfile, display_name: 'Updated elsewhere' }
  await user.click(screen.getByLabelText('Preferred language'))
  await user.click(await screen.findByRole('option', { name: 'English' }))
  await waitFor(() => expect(nickname).toHaveValue('Updated elsewhere'))
})
function renderProfile() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <PersonalProfile />
    </QueryClientProvider>
  )
}

it('loads the masked bound phone and keeps the unavailable avatar action focusable and inert', async () => {
  const user = userEvent.setup()
  renderProfile()
  expect(await screen.findByLabelText('Phone number')).toHaveValue(
    '138****8000'
  )
  expect(screen.queryByLabelText('Login email')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Invoice title')).not.toBeInTheDocument()
  const change = screen.getByRole('button', { name: 'Change avatar' })
  expect(change).toHaveAttribute('aria-disabled', 'true')
  await user.tab()
  expect(change).toHaveFocus()
  await waitFor(() => expect(change).toHaveAttribute('data-popup-open'))
  await user.click(change)
  expect(screen.queryByLabelText('Upload avatar')).not.toBeInTheDocument()
})

it('saves the nickname without clearing the username and updates the account name', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const user = userEvent.setup()
  renderProfile()
  const nickname = await screen.findByLabelText('Nickname')
  await user.clear(nickname)
  await user.type(nickname, 'New name')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/user/self', {
      username: 'alice',
      display_name: 'New name',
    })
  )
  expect(useAuthStore.getState().auth.user?.display_name).toBe('New name')
})

it('shows phone load failure as unavailable with a retry instead of displaying an unbound phone', async () => {
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: url.endsWith('/status')
      ? { success: false, message: 'Phone unavailable' }
      : { success: true, data: profile },
  }))
  renderProfile()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Failed to load phone number'
  )
  expect(screen.getByLabelText('Phone number')).toHaveValue(
    'Temporarily unavailable'
  )
  expect(
    screen.getByRole('button', { name: 'Bind phone number' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
})

it.each(['password', 'wechat'])(
  'verifies %s when Bind is clicked before opening the new-phone dialog',
  async (method) => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      let data: unknown = profile
      if (url.endsWith('/captcha')) {
        data = {
          challenge_token: 'image-token',
          image: 'data:image/png;base64,AA==',
        }
      } else if (url.endsWith('/status')) {
        data = { bound: false, phone_masked: '', verification_required: true }
      } else if (url === '/api/verify/methods') {
        data = {
          scope: 'phone.binding',
          methods: [{ method, available: true }],
          oauth_providers: [],
          password_encryption_enabled: false,
        }
      }
      return { data: { success: true, data } }
    })
    const post = vi.spyOn(api, 'post').mockImplementation(async (url) => ({
      data: {
        success: true,
        data:
          url === '/api/verify'
            ? {
                proof_token: 'initial-proof',
                method,
                scope: 'phone.binding',
                expires_at: Date.now() / 1000 + 300,
              }
            : {
                token: 'binding-authorization',
                expires_at: Date.now() / 1000 + 600,
                retry_after: 90,
              },
      },
    }))
    const user = userEvent.setup()
    renderProfile()
    await user.click(
      await screen.findByRole('button', { name: 'Bind phone number' })
    )
    expect(screen.queryByLabelText('New phone number')).not.toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
    const field =
      method === 'password' ? 'Password' : 'WeChat verification code'
    await user.type(
      await screen.findByLabelText(field, { selector: 'input' }),
      method === 'password' ? 'account-password' : '123456'
    )
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    await user.type(
      await screen.findByLabelText('New phone number'),
      '13900139000'
    )
    expect(post).toHaveBeenCalledWith(
      '/api/user/phone/change/start',
      {},
      expect.objectContaining({
        headers: { 'X-Security-Proof': 'initial-proof' },
        singleUseAuthorization: true,
      })
    )
    await user.type(screen.getByLabelText('Image verification code'), '12345')
    await user.click(screen.getByRole('button', { name: 'Get code' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/api/user/phone/change/send',
        {
          step: 'new',
          phone: '13900139000',
          verification_token: 'binding-authorization',
          captcha_token: 'image-token',
          captcha_answer: '12345',
        },
        expect.objectContaining({ singleUseAuthorization: true })
      )
    )
    expect(
      post.mock.calls.filter(([url]) => url === '/api/verify')
    ).toHaveLength(1)
  }
)

it('cancelling initial identity verification keeps the phone dialog closed and sends no SMS', async () => {
  vi.mocked(api.get).mockImplementation(async (url) => {
    let data: unknown = profile
    if (url.endsWith('/status')) {
      data = { bound: false, phone_masked: '', verification_required: true }
    } else if (url === '/api/verify/methods') {
      data = {
        scope: 'phone.binding',
        methods: [{ method: 'password', available: true }],
        oauth_providers: [],
        password_encryption_enabled: false,
      }
    }
    return { data: { success: true, data } }
  })
  const post = vi.spyOn(api, 'post')
  const user = userEvent.setup()
  renderProfile()
  await user.click(
    await screen.findByRole('button', { name: 'Bind phone number' })
  )
  await user.click(await screen.findByRole('button', { name: 'Cancel' }))
  expect(screen.queryByLabelText('New phone number')).not.toBeInTheDocument()
  expect(post).not.toHaveBeenCalled()
})

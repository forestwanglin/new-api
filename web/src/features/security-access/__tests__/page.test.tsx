import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { SecurityAccess } from '../index'

const profile = {
  id: 1,
  username: 'alice',
  display_name: 'Alice',
  role: 1,
  wechat_id: '',
  setting: '{}',
}
let bound = true
let wechatBound = false
let phoneFailed = false
let wechatEnabled = true
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  bound = true
  wechatBound = false
  phoneFailed = false
  wechatEnabled = true
  useAuthStore.getState().auth.setUser(profile)
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/self') {
      return {
        data: {
          success: true,
          data: { ...profile, wechat_id: wechatBound ? 'owner' : '' },
        },
      }
    }
    if (url === '/api/user/phone/change/status') {
      return {
        data: phoneFailed
          ? { success: false, message: 'Phone unavailable' }
          : {
              success: true,
              data: {
                bound,
                phone_masked: bound ? '138****8000' : '',
                verification_required: false,
              },
            },
      }
    }
    if (url === '/api/oauth/wechat/bind/verification') {
      return {
        data: {
          success: true,
          data: { sms_required: true, phone_masked: '138****8000' },
        },
      }
    }
    if (url === '/api/verify/methods') {
      return {
        data: {
          success: true,
          data: {
            scope: 'phone.binding',
            methods: [{ method: 'password', available: true }],
            oauth_providers: [],
            password_encryption_enabled: false,
          },
        },
      }
    }
    if (url === '/api/user/sessions') {
      return { data: { success: true, data: [] } }
    }
    if (url === '/api/user/access_tokens') {
      return { data: { success: true, data: { items: [], legacy: null } } }
    }
    if (url === '/api/user/access_tokens/catalog') {
      return {
        data: {
          success: true,
          data: { groups: [], max_tokens: 20, default_expiry_days: 30 },
        },
      }
    }
    throw new Error(`Unexpected GET ${url}`)
  })
})
afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.reset('idle')
  vi.restoreAllMocks()
})
async function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], {
    wechat_login: wechatEnabled,
    wechat_qrcode: '',
  })
  const root = createRootRoute()
  const page = createRoute({
    getParentRoute: () => root,
    path: '/security-access',
    component: SecurityAccess,
  })
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/security-access'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('heading', { name: 'Account security' })
  return client
}
it('places access tokens between account security and devices and switches the selected panel with the keyboard', async () => {
  const user = userEvent.setup()
  await renderPage()
  const tabs = screen.getAllByRole('tab')
  expect(tabs.map((tab) => tab.textContent)).toEqual([
    'Account security',
    'Access Tokens',
    'Login devices',
  ])
  tabs[0].focus()
  await user.keyboard('{ArrowDown}')
  expect(tabs[1]).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
  expect(
    await screen.findByRole('button', { name: 'Create access token' })
  ).toBeVisible()
  await user.click(tabs[2])
  expect(await screen.findByText('No active login sessions')).toBeVisible()
})
it('opens the existing phone replacement flow for a bound account', async () => {
  const user = userEvent.setup()
  await renderPage()
  await waitFor(() =>
    expect(screen.getByLabelText('Phone number')).toHaveValue('138****8000')
  )
  await user.click(screen.getByRole('button', { name: 'Change phone number' }))
  expect(await screen.findByLabelText('Current phone number')).toHaveValue(
    '138****8000'
  )
})
it('offers first phone binding when the account has no number', async () => {
  bound = false
  const user = userEvent.setup()
  await renderPage()
  await user.click(screen.getByRole('button', { name: 'Bind phone number' }))
  expect(
    await screen.findByRole('dialog', { name: 'Security verification' })
  ).toBeVisible()
  expect(screen.queryByLabelText('New phone number')).not.toBeInTheDocument()
})
it('disables phone binding and offers retry when phone status fails', async () => {
  phoneFailed = true
  await renderPage()
  expect(await screen.findByLabelText('Phone number')).toHaveValue(
    'Temporarily unavailable'
  )
  expect(
    screen.getByRole('button', { name: 'Bind phone number' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
})
it('opens the original WeChat binding dialog for an unbound account', async () => {
  const user = userEvent.setup()
  await renderPage()
  await user.click(screen.getByRole('button', { name: 'Bind WeChat' }))
  expect(await screen.findByLabelText('WeChat verification code')).toBeVisible()
  expect(await screen.findByLabelText('SMS verification code')).toBeVisible()
})
it('shows the bound WeChat state without offering rebinding', async () => {
  wechatBound = true
  await renderPage()
  expect(screen.getByLabelText('WeChat binding')).toHaveValue('Bound')
  expect(
    screen.queryByRole('button', { name: 'Bind WeChat' })
  ).not.toBeInTheDocument()
})
it('shows unavailable WeChat binding when the provider is disabled', async () => {
  wechatEnabled = false
  await renderPage()
  expect(screen.getByRole('button', { name: 'Bind WeChat' })).toBeDisabled()
  expect(screen.getByLabelText('WeChat binding')).toHaveValue(
    'Temporarily unavailable'
  )
})

it('completes first phone binding through the shared identity verification and refreshes the masked number', async () => {
  bound = false
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url === '/api/verify') {
      return {
        data: {
          success: true,
          data: {
            proof_token: 'initial-proof',
            method: 'password',
            scope: 'phone.binding',
            expires_at: Date.now() / 1000 + 300,
          },
        },
      }
    }
    if (url === '/api/user/phone/change/complete') bound = true
    return {
      data: {
        success: true,
        data: {
          token: 'binding-token',
          expires_at: Date.now() / 1000 + 600,
          retry_after: 90,
        },
      },
    }
  })
  const user = userEvent.setup()
  await renderPage()
  await user.click(
    await screen.findByRole('button', { name: 'Bind phone number' })
  )
  await user.type(
    await screen.findByLabelText('Password', { selector: 'input' }),
    'account-password'
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
    })
  )
  await user.click(screen.getByRole('button', { name: 'Get code' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Get code' })
    ).not.toBeInTheDocument()
  )
  await user.type(screen.getByLabelText('Verification code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Confirm binding' }))
  await waitFor(() =>
    expect(screen.getByLabelText('Phone number')).toHaveValue('138****8000')
  )
  expect(post).toHaveBeenCalledWith(
    '/api/user/phone/change/send',
    { step: 'new', phone: '13900139000', verification_token: 'binding-token' },
    expect.objectContaining({ singleUseAuthorization: true })
  )
  expect(post).toHaveBeenCalledWith(
    '/api/user/phone/change/complete',
    { token: 'binding-token' },
    expect.objectContaining({ acceptAuthRotation: true })
  )
})

it('closes the WeChat dialog and refreshes the bound state after the original binding succeeds', async () => {
  vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url.endsWith('/sms/send')) {
      return {
        data: {
          success: true,
          data: { sms_token: 'sms-flow', retry_after: 90 },
        },
      }
    }
    if (url.endsWith('/sms/verify')) {
      return { data: { success: true, data: { proof_token: 'sms-proof' } } }
    }
    wechatBound = true
    return { data: { success: true, data: {} } }
  })
  const user = userEvent.setup()
  await renderPage()
  await user.click(screen.getByRole('button', { name: 'Bind WeChat' }))
  await user.type(
    await screen.findByLabelText('WeChat verification code'),
    'wx-code'
  )
  await user.click(screen.getByRole('button', { name: 'Send code' }))
  await user.type(screen.getByLabelText('SMS verification code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Bind' }))
  await waitFor(() =>
    expect(screen.getByLabelText('WeChat binding')).toHaveValue('Bound')
  )
  expect(
    screen.queryByLabelText('WeChat verification code')
  ).not.toBeInTheDocument()
})

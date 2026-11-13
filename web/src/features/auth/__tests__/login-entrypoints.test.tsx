import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { LoginSessionsCard } from '@/features/security/components/login-sessions-card'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'

import { Otp } from '../otp'
import { ResetPasswordConfirm } from '../reset-password-confirm'

let client: QueryClient
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  client.clear()
  vi.restoreAllMocks()
  useLoginModalStore.getState().close()
  useAuthStore.getState().auth.reset()
})

async function renderEntry(component: () => React.ReactNode) {
  const root = createRootRoute({ component: Outlet })
  const page = createRoute({
    getParentRoute: () => root,
    path: '/entry',
    component,
  })
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <div>Public home</div>,
  })
  const router = createRouter({
    routeTree: root.addChildren([page, home]),
    history: createMemoryHistory({ initialEntries: ['/entry'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}

it('opens the login modal on the password recovery page without navigating', async () => {
  const router = await renderEntry(() => <ResetPasswordConfirm />)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Back to login' })
  )
  expect(useLoginModalStore.getState().isOpen).toBe(true)
  expect(router.state.location.pathname).toBe('/entry')
})

it('reopens the login modal from the expired verification page without navigating', async () => {
  const router = await renderEntry(Otp)
  await screen.findByRole('heading', { name: 'Security verification' })
  useLoginModalStore.getState().close()
  await userEvent.click(screen.getByRole('button', { name: 'Re-login' }))
  expect(useLoginModalStore.getState().isOpen).toBe(true)
  expect(router.state.location.pathname).toBe('/entry')
})

it('removes private session controls and opens login on the public home after revoking this device', async () => {
  const session = {
    sid: 'current-device',
    current: true,
    login_method: 'password',
    ip: '127.0.0.1',
    user_agent: 'Browser',
    created_at: 1,
    last_active_at: 1,
    expires_at: 9999999999,
  }
  useAuthStore.getState().auth.setBundle({
    user: { id: 1, username: 'user', role: 1 },
    access_token: 'access',
    access_expires_at: 9999999999,
    token_type: 'Bearer',
    session,
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: [session] },
  })
  const remove = vi
    .spyOn(api, 'delete')
    .mockResolvedValue({ data: { success: true } })
  const router = await renderEntry(LoginSessionsCard)
  await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Sign out this device?',
  })
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Sign out' })
  )
  await screen.findByText('Public home')
  await waitFor(() => expect(useLoginModalStore.getState().isOpen).toBe(true))
  expect(router.state.location.pathname).toBe('/')
  expect(useAuthStore.getState().auth.user).toBeNull()
  expect(
    screen.queryByRole('button', { name: 'Sign out' })
  ).not.toBeInTheDocument()
  expect(remove).toHaveBeenCalledExactlyOnceWith(
    '/api/user/sessions/current-device'
  )
})

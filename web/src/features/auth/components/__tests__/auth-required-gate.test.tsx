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
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor, act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import {
  AuthenticatedModule,
  AuthenticationRouteError,
} from '@/features/auth/components/auth-required-gate'
import { requireAuthentication } from '@/lib/require-authentication'
import { useAuthStore, type AuthBundle } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'

vi.mock('@/components/layout/components/public-layout', () => ({
  PublicLayout: (props: { children: React.ReactNode }) => (
    <main>{props.children}</main>
  ),
}))

const bundle: AuthBundle = {
  access_token: 'test-access',
  token_type: 'Bearer',
  access_expires_at: 4_000_000_000,
  user: { id: 1, username: 'test-user', role: 1 },
  session: {
    sid: 'test-session',
    current: true,
    login_method: 'phone',
    ip: '',
    user_agent: '',
    created_at: 1,
    last_active_at: 1,
    expires_at: 4_000_000_000,
  },
}
const clients: QueryClient[] = []

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
  useLoginModalStore.getState().close()
  clients.splice(0).forEach((client) => client.clear())
})

async function loadProtectedRoute() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  let loaded = false
  const root = createRootRoute({ component: Outlet })
  const parent = createRoute({
    getParentRoute: () => root,
    id: '_protected',
    beforeLoad: requireAuthentication,
    component: Outlet,
    errorComponent: AuthenticationRouteError,
  })
  const page = createRoute({
    getParentRoute: () => parent,
    path: '/private',
    loader: () => {
      loaded = true
    },
    component: () => <div>Private data</div>,
  })
  const router = createRouter({
    routeTree: root.addChildren([parent.addChildren([page])]),
    history: createMemoryHistory({ initialEntries: ['/private?tab=one'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { router, loaded: () => loaded }
}

it('keeps anonymous visitors on the requested URL and blocks protected loaders until sign-in', async () => {
  vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(function (
    this: XMLHttpRequest
  ) {
    Object.defineProperties(this, {
      status: { value: 401, configurable: true },
      responseText: { value: '{}', configurable: true },
      readyState: { value: 4, configurable: true },
    })
    this.onloadend?.(new ProgressEvent('loadend'))
  })
  const { router, loaded } = await loadProtectedRoute()
  expect(loaded()).toBe(false)
  expect(screen.queryByText('Private data')).not.toBeInTheDocument()
  await waitFor(() => expect(useLoginModalStore.getState().isOpen).toBe(true))
  expect(useLoginModalStore.getState().redirectTo).toBe('/private?tab=one')
  expect(router.state.location.href).toBe('/private?tab=one')

  await act(async () => {
    useAuthStore.getState().auth.setBundle(bundle)
    await router.invalidate()
  })
  expect(await screen.findByText('Private data')).toBeVisible()
  expect(loaded()).toBe(true)
})

it('does not open a login modal while preloading an anonymous protected route', async () => {
  const root = createRootRoute({ component: Outlet })
  const home = createRoute({ getParentRoute: () => root, path: '/' })
  const page = createRoute({
    getParentRoute: () => root,
    path: '/private',
    beforeLoad: requireAuthentication,
    errorComponent: AuthenticationRouteError,
  })
  vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(function (
    this: XMLHttpRequest
  ) {
    Object.defineProperties(this, {
      status: { value: 401, configurable: true },
      responseText: { value: '{}', configurable: true },
      readyState: { value: 4, configurable: true },
    })
    this.onloadend?.(new ProgressEvent('loadend'))
  })
  const router = createRouter({
    routeTree: root.addChildren([home, page]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  await router.preloadRoute({ to: '/private' })
  expect(useLoginModalStore.getState().isOpen).toBe(false)
  expect(router.state.location.pathname).toBe('/')
})

it.each([true, false])(
  'removes mounted module data on session loss only when requiresAuth is %s',
  async (requiresAuth) => {
    useAuthStore.getState().auth.setBundle(bundle)
    const root = createRootRoute({
      component: () => (
        <AuthenticatedModule requiresAuth={requiresAuth}>
          <div>Module data</div>
        </AuthenticatedModule>
      ),
    })
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    await router.load()
    render(<RouterProvider router={router} />)
    expect(await screen.findByText('Module data')).toBeVisible()
    await act(async () => {
      useAuthStore.getState().auth.reset()
    })
    if (requiresAuth) {
      expect(screen.queryByText('Module data')).not.toBeInTheDocument()
      expect(useLoginModalStore.getState().isOpen).toBe(true)
    } else {
      expect(screen.getByText('Module data')).toBeVisible()
      expect(useLoginModalStore.getState().isOpen).toBe(false)
    }
  }
)

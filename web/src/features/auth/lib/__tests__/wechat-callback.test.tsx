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
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { Route as OAuthRoute } from '@/routes/(auth)/oauth'
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
  useLoginModalStore.getState().close()
})

it('exchanges a WeChat one-time callback only once under StrictMode and continues phone binding', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        browser_token: 'browser-proof',
        challenge_token: 'challenge',
        image: 'data:image/png;base64,AA==',
      },
    },
  })
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: { require_phone_binding: true, bind_token: 'pending-bind' },
    },
  })
  const root = createRootRoute({ component: Outlet })
  const auth = createRoute({
    getParentRoute: () => root,
    id: '(auth)',
    component: Outlet,
  })
  const oauth = createRoute({
    getParentRoute: () => auth,
    path: '/oauth',
    component: OAuthRoute.options.component,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([oauth])]),
    history: createMemoryHistory({
      initialEntries: ['/oauth?provider=wechat&code=one-time-code'],
    }),
  })
  await router.load()
  render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  )
  await waitFor(() =>
    expect(useLoginModalStore.getState().bindToken).toBe('pending-bind')
  )
  expect(post).toHaveBeenCalledTimes(1)
  expect(get).toHaveBeenCalledTimes(1)
  expect(useLoginModalStore.getState().redirectTo).toBe('/dashboard')
})

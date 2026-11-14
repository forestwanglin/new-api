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
import { act, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { MySubscription } from '..'

vi.mock('@/components/layout', () => ({
  SectionPageLayout: Object.assign(
    ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
    {
      Title: ({ children }: { children: React.ReactNode }) => (
        <h1>{children}</h1>
      ),
      Description: ({ children }: { children: React.ReactNode }) => (
        <p>{children}</p>
      ),
      Actions: ({ children }: { children: React.ReactNode }) => (
        <nav>{children}</nav>
      ),
      Content: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
      ),
    }
  ),
}))
const active = {
  id: '9007199254740993',
  plan_id: '42',
  plan_title: 'Archived purchased plan',
  status: 'active',
  priority: 9,
  billing_cycle: 'month',
  remaining_duration_ms: '2592000000',
  purchased_at: '1794614400000',
  first_activated_at: '1794614400000',
  active_since_at: '1794614400000',
  active_until_at: '1797206437000',
  ended_at: null,
}
const self = {
  active_subscription_id: active.id,
  observed_at: '1794614400000',
  items: [
    active,
    {
      ...active,
      id: '2',
      plan_title: 'Paused purchased plan',
      status: 'paused',
      priority: 2,
      remaining_duration_ms: '86400000',
      active_since_at: null,
      active_until_at: null,
    },
  ],
}
afterEach(() => useAuthStore.getState().auth.reset())
async function renderPage() {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'buyer', role: 1 })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: MySubscription }),
    history: createMemoryHistory({ initialEntries: ['/my-subscription'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
it('shows purchased snapshot identity and exact backend expiry, preserving the personal entitlement schedule', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: self },
  })
  await renderPage()
  const card = await screen.findByRole('region', { name: 'My subscription' })
  expect(
    await within(card).findByRole('heading', { name: active.plan_title })
  ).toBeVisible()
  const expiry = within(card).getByText('Service expires').closest('div')
  expect(expiry?.querySelector('time')).toHaveAttribute(
    'datetime',
    '2026-12-14T00:00:37.000Z'
  )
  expect(expiry?.textContent).toContain(':37')
  expect(
    screen.getByRole('heading', {
      name: 'My subscription and entitlement schedule',
    })
  ).toBeVisible()
  expect(screen.getByText('Paused purchased plan')).toBeVisible()
  expect(screen.getByText('Remaining service: 2,592,000 seconds')).toBeVisible()
})
it('links both shortcuts to the top subscription tabs and keeps automatic renewal disabled and unchecked', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: self },
  })
  await renderPage()
  expect(
    screen.getByRole('link', { name: 'Subscription orders' })
  ).toHaveAttribute('href', '/subscription?tab=orders')
  expect(
    screen.getByRole('link', { name: 'View subscription plans' })
  ).toHaveAttribute('href', '/subscription?tab=plans')
  expect(
    screen.getByRole('link', { name: 'View renewal offers' })
  ).toHaveAttribute('href', '/subscription?tab=plans')
  const toggle = screen.getByRole('switch', { name: 'Automatic renewal' })
  expect(toggle).toHaveAttribute('aria-disabled', 'true')
  expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(toggle).toHaveAccessibleDescription(
    'Automatic renewal is not available yet. One-time purchases do not authorize future charges.'
  )
})
it('removes the previous viewer subscription while another viewer request is pending', async () => {
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce({ data: { success: true, data: self } })
    .mockImplementation(() => new Promise(() => {}))
  await renderPage()
  expect(
    await screen.findByRole('heading', { name: active.plan_title })
  ).toBeVisible()
  await act(async () =>
    useAuthStore.getState().auth.setUser({ id: 2, username: 'other', role: 1 })
  )
  expect(screen.queryByText(active.plan_title)).not.toBeInTheDocument()
  expect(screen.queryByText('Paused purchased plan')).not.toBeInTheDocument()
})
it('shows no active subscription and no epoch date for an empty account', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        active_subscription_id: null,
        observed_at: '1794614400000',
        items: [],
      },
    },
  })
  await renderPage()
  expect(
    await screen.findByText('No purchased subscriptions yet')
  ).toBeVisible()
  expect(
    within(screen.getByRole('region', { name: 'My subscription' })).getByText(
      'No active subscription'
    )
  ).toBeVisible()
  expect(document.querySelector('time')).toBeNull()
})

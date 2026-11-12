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
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  parseSidebarModulesAdmin,
  serializeSidebarModulesAdmin,
} from '@/features/system-settings/maintenance/config'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { useSidebarView } from '../use-sidebar-view'

afterEach(() => {
  useAuthStore.getState().auth.reset()
})

function AdminEntries() {
  const sidebar = useSidebarView()
  const admin = sidebar.navGroups.find((group) => group.id === 'admin')
  return (
    <nav aria-label='Admin'>
      {admin?.items.map((item) => (
        <a key={item.title} href={item.url}>
          {item.title}
        </a>
      ))}
    </nav>
  )
}

async function renderSidebar(role: number, admin?: object, user?: object) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], {
    SidebarModulesAdmin: admin ? JSON.stringify(admin) : '',
  })
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'admin',
    role,
    permissions: { sidebar_settings: true },
    sidebar_modules: user ? JSON.stringify(user) : '',
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: AdminEntries }),
    history: createMemoryHistory({ initialEntries: ['/points'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('points sidebar', () => {
  it('inherits points for historical configs and places it immediately after Users', async () => {
    await renderSidebar(
      ROLE.ADMIN,
      { admin: { enabled: true, user: true } },
      { admin: { enabled: true, user: true } }
    )
    const links = screen.getAllByRole('link')
    const users = links.findIndex((link) => link.textContent === 'Users')
    expect(links[users + 1]).toHaveTextContent('Points')
    expect(links[users + 1]).toHaveAttribute('href', '/points')
  })
  it.each([
    [{ admin: { enabled: true, points: false } }, undefined],
    [{ admin: { enabled: false } }, undefined],
    [undefined, { admin: { enabled: true, points: false } }],
  ])('respects admin and user disablement (%j, %j)', async (admin, user) => {
    await renderSidebar(ROLE.ADMIN, admin, user)
    expect(
      screen.queryByRole('link', { name: 'Points' })
    ).not.toBeInTheDocument()
  })
  it('hides Points from ordinary users', async () => {
    await renderSidebar(ROLE.USER)
    expect(
      screen.queryByRole('link', { name: 'Points' })
    ).not.toBeInTheDocument()
  })
  it('defaults the maintenance setting on and preserves a saved false', () => {
    const config = parseSidebarModulesAdmin(
      '{"admin":{"enabled":true,"user":true}}'
    )
    expect(config.admin.points).toBe(true)
    config.admin.points = false
    expect(
      parseSidebarModulesAdmin(serializeSidebarModulesAdmin(config)).admin
        .points
    ).toBe(false)
  })
})

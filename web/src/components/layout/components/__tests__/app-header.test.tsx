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
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { SidebarProvider } from '@/components/ui/sidebar'
import { SearchProvider } from '@/context/search-provider'
import { api } from '@/lib/api'

import { AppHeader } from '../app-header'

let client: QueryClient

afterEach(() => {
  cleanup()
  client?.clear()
})

it('keeps mobile top navigation reachable without the desktop-only wrapper', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: { success: true, data: url === '/api/notice' ? '' : {} },
  }))
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRootRoute({
    component: () => (
      <SidebarProvider>
        <AppHeader
          showSearch={false}
          showConfigDrawer={false}
          showProfileDropdown={false}
        />
      </SidebarProvider>
    ),
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  const navigation = await screen.findByRole('button', {
    name: 'Toggle navigation menu',
  })
  expect(navigation.closest('.hidden')).toBeNull()
  expect(screen.getByRole('button', { name: 'Change language' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Notifications' })).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Search' })
  ).not.toBeInTheDocument()
})

it('reuses public navigation styling and keeps the console header in document flow', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: { success: true, data: url === '/api/notice' ? '' : {} },
  }))
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRootRoute({
    component: () => (
      <SearchProvider>
        <SidebarProvider>
          <AppHeader showProfileDropdown={false} showConfigDrawer={false} />
        </SidebarProvider>
      </SearchProvider>
    ),
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  expect(await screen.findByRole('link', { name: 'Models' })).toHaveClass(
    'rounded-[8px]',
    'text-[15px]',
    'px-[15px]'
  )
  expect(screen.getByRole('link', { name: 'Homepage' })).toHaveAttribute(
    'aria-current',
    'page'
  )
  expect(screen.getByRole('button', { name: 'Search' })).toHaveClass(
    'sm:w-8',
    'lg:w-8',
    'xl:w-64'
  )
  expect(screen.getByRole('banner')).toHaveClass('sticky', 'shrink-0')
  expect(screen.getByRole('banner')).not.toHaveClass('fixed')
  expect(
    screen.getByRole('banner').querySelector('a[href="/model"]')
  ).not.toBeNull()
  expect(screen.getByRole('button', { name: 'Toggle Sidebar' })).toBeVisible()
})

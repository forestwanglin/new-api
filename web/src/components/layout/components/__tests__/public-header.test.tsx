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
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { PublicHeader, type PublicHeaderProps } from '../public-header'

const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
})

async function renderHeader(props: PublicHeaderProps = {}) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: { success: true, data: url === '/api/notice' ? '' : {} },
  }))
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  const root = createRootRoute({
    component: () => <PublicHeader siteName='New API' {...props} />,
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

it('provides one language and notification control outside desktop-only navigation', async () => {
  await renderHeader()
  const language = await screen.findByRole('button', {
    name: 'Change language',
  })
  const notice = screen.getByRole('button', { name: 'Notifications' })
  expect(language.closest('.hidden')).toBeNull()
  expect(notice.closest('.hidden')).toBeNull()
  expect(
    screen.getAllByRole('button', { name: 'Change language' })
  ).toHaveLength(1)
})

it('preserves custom right content and navigation visibility', async () => {
  await renderHeader({
    rightContent: <button type='button'>Custom action</button>,
    showNavigation: false,
  })
  expect(screen.getByRole('button', { name: 'Custom action' })).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Change language' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Toggle navigation menu' })
  ).not.toBeInTheDocument()
})

it('keeps configured hidden tools absent', async () => {
  await renderHeader({
    showLanguageSwitcher: false,
    showThemeSwitch: false,
    showNotifications: false,
  })
  expect(
    screen.queryByRole('button', { name: 'Change language' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Notifications' })
  ).not.toBeInTheDocument()
})

it('does not expose closed mobile navigation and restores focus after Escape', async () => {
  await renderHeader({ navLinks: [{ title: 'Example', href: '/example' }] })
  const trigger = await screen.findByRole('button', {
    name: 'Toggle navigation menu',
  })
  expect(
    screen.queryByRole('dialog', { name: 'Toggle navigation menu' })
  ).not.toBeInTheDocument()
  const user = userEvent.setup()
  await user.click(trigger)
  const dialog = await screen.findByRole('dialog', {
    name: 'Toggle navigation menu',
  })
  expect(within(dialog).getByRole('link', { name: 'Home' })).toHaveAttribute(
    'href',
    '/'
  )
  await user.keyboard('{Escape}')
  expect(trigger).toHaveFocus()
})

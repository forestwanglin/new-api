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

import { api } from '@/lib/api'

import { PublicLayout } from '../public-layout'

const clients: QueryClient[] = []

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
})

async function renderLayout(showMainContainer: boolean) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: { success: true, data: url === '/api/notice' ? '' : {} },
  }))
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  const root = createRootRoute({
    component: () => (
      <PublicLayout showMainContainer={showMainContainer}>
        {showMainContainer ? (
          <p>Page content</p>
        ) : (
          <>
            <main>Page content</main>
            <footer>Page footer</footer>
          </>
        )}
      </PublicLayout>
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
  await screen.findByRole('main')
}

it('gives short custom page content the remaining viewport space above its footer', async () => {
  await renderLayout(false)

  const main = screen.getByRole('main')
  const layout = main.parentElement
  expect(layout).toHaveClass('min-h-svh', 'flex', 'flex-col')
  expect(layout).toHaveClass('[&>main]:flex-1')
  expect(layout).toHaveClass('[&>footer]:shrink-0')
  expect(layout).not.toHaveClass('h-svh', 'overflow-hidden')
  expect(screen.getByRole('contentinfo')).not.toHaveClass('fixed', 'absolute')
})

it('keeps the default main container in the same expanding document-flow layout', async () => {
  await renderLayout(true)

  const main = screen.getByRole('main')
  expect(main).toHaveTextContent('Page content')
  expect(main.parentElement).toHaveClass('min-h-svh', 'flex', 'flex-col')
  expect(main.parentElement).toHaveClass('[&>main]:flex-1')
})

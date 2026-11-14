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
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { PointsWallet } from '..'

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
      Content: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
      ),
    }
  ),
}))
afterEach(() => useAuthStore.getState().auth.reset())
async function renderWallet() {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'viewer', role: 1 })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: PointsWallet }),
    history: createMemoryHistory({ initialEntries: ['/points-wallet'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
it('shows exact available totals, separates frozen points and marks unsupported pending amounts unavailable', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/points/wallet/self'
          ? {
              balances: [
                {
                  point_type_id: '1',
                  code: 'GENERAL',
                  name: 'General',
                  available_points: '9007199254740993',
                  frozen_points: '500',
                },
                {
                  point_type_id: '2',
                  code: 'GPT',
                  name: 'GPT',
                  available_points: '10',
                  frozen_points: '0',
                },
              ],
              pending_gpt_points: null,
              source_summaries: [],
            }
          : {
              items: [
                {
                  id: '1',
                  rule_key: 'wallet-test',
                  title: 'Configured wallet rule',
                  content: {
                    blocks: [
                      {
                        type: 'paragraph',
                        children: [{ text: 'Configured policy' }],
                      },
                    ],
                  },
                },
              ],
            },
    },
  }))
  await renderWallet()
  expect(await screen.findByText('9,007,199,254,741,003')).toBeVisible()
  const stats = screen.getByRole('region', { name: 'Wallet statistics' })
  expect(within(stats).getByText('9,007,199,254,740,993')).toBeVisible()
  expect(within(stats).getByText('Not available yet')).toBeVisible()
  expect(screen.getByRole('link', { name: 'View more' })).toHaveAttribute(
    'href',
    '/point-ledger'
  )
  expect(await screen.findByText('Configured wallet rule')).toBeInTheDocument()
  expect(screen.getByText('500')).toBeVisible()
})
it('shows a retryable failure instead of fabricating zero balances', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: false, message: 'Wallet unavailable' },
  })
  await renderWallet()
  expect(
    await screen.findAllByRole('button', { name: 'Retry' })
  ).not.toHaveLength(0)
  expect(
    screen.queryByRole('region', { name: 'Wallet statistics' })
  ).not.toBeInTheDocument()
})

it('renders cumulative source movements above int64 without treating them as a remaining balance', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/points/wallet/self'
          ? {
              balances: [],
              pending_gpt_points: null,
              source_summaries: [
                {
                  point_type_id: '1',
                  point_type_code: 'GENERAL',
                  point_type_name: 'General',
                  biz_type: 'historical_source',
                  increased_points: '18446744073709551614',
                  decreased_points: '9223372036854775807',
                  net_points: '9223372036854775807',
                },
              ],
            }
          : { items: [] },
    },
  }))
  await renderWallet()
  expect(await screen.findByText('18,446,744,073,709,551,614')).toBeVisible()
  expect(screen.getByText('Cumulative movements by source')).toBeVisible()
  expect(screen.getByText('historical_source')).toBeVisible()
  expect(screen.getByText('No points accounts')).toBeVisible()
  expect(screen.getByText('No points rules configured')).toBeVisible()
})
it('opens database configured rule content from its accessible disclosure', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/points/wallet/self'
          ? { balances: [], pending_gpt_points: null, source_summaries: [] }
          : {
              items: [
                {
                  id: '1',
                  rule_key: 'wallet-test',
                  title: 'Configured title',
                  content: {
                    blocks: [
                      {
                        type: 'paragraph',
                        children: [{ text: 'Configured policy' }],
                      },
                    ],
                  },
                },
              ],
            },
    },
  }))
  await renderWallet()
  const disclosure = await screen.findByText('View full points rules (1)')
  expect(disclosure.closest('details')).not.toHaveAttribute('open')
  await user.click(disclosure)
  expect(disclosure.closest('details')).toHaveAttribute('open')
  expect(screen.getByText('Configured policy')).toBeVisible()
})
it('removes the previous viewer balances while loading another viewer account', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/points/wallet/self'
          ? {
              balances: [
                {
                  point_type_id: '1',
                  code: 'GENERAL',
                  name: 'General',
                  available_points: '12345',
                  frozen_points: '0',
                },
              ],
              pending_gpt_points: null,
              source_summaries: [],
            }
          : { items: [] },
    },
  }))
  await renderWallet()
  expect((await screen.findAllByText('12,345')).length).toBeGreaterThan(0)
  vi.mocked(api.get).mockImplementation(() => new Promise(() => {}))
  await act(async () =>
    useAuthStore.getState().auth.setUser({ id: 2, username: 'other', role: 1 })
  )
  expect(screen.queryByText('12,345')).not.toBeInTheDocument()
})

it('marks missing point types and the combined total unavailable while preserving confirmed zero accounts', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/points/wallet/self'
          ? {
              balances: [
                {
                  point_type_id: '1',
                  code: 'GENERAL',
                  name: 'General',
                  available_points: '0',
                  frozen_points: '0',
                },
              ],
              pending_gpt_points: null,
              source_summaries: [],
            }
          : { items: [] },
    },
  }))
  await renderWallet()
  const stats = await screen.findByRole('region', { name: 'Wallet statistics' })
  const general = within(stats)
    .getByRole('heading', { name: 'General points balance' })
    .closest('div')
  if (!general) throw new Error('General points card is missing')
  expect(within(general).getByText('0')).toBeVisible()
  for (const title of ['Total credited points', 'GPT-specific points']) {
    const card = within(stats)
      .getByRole('heading', { name: title })
      .closest('div')
    if (!card) throw new Error(`${title} card is missing`)
    expect(within(card).getByText('Not available yet')).toBeVisible()
    expect(within(card).queryByText('0')).not.toBeInTheDocument()
  }
})

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
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { SubscriptionOrders } from '../orders'

const order = {
  id: '9007199254740993',
  plan_id: '42',
  plan_title: 'Archived plan',
  trade_no: 'NEWEST',
  billing_cycle: 'month',
  currency: 'CNY',
  amount_due_minor: '12345',
  amount_paid_minor: '0',
  paid_points: '9007199254740993',
  bonus_points: '7',
  auto_bonus_points: '11',
  payment_method: 'wxpay',
  status: 'pending',
  fulfillment_status: 'pending',
  created_at: '1794614400000',
  paid_at: null,
}
afterEach(() => useAuthStore.getState().auth.reset())
function renderOrders() {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'buyer', role: 1 })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <SubscriptionOrders />
    </QueryClientProvider>
  )
}
it('preserves server descending order, snapshot title, exact points and pending amount due', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        page: 1,
        page_size: 20,
        total: 2,
        items: [
          order,
          {
            ...order,
            id: '2',
            trade_no: 'OLDER',
            status: 'success',
            fulfillment_status: 'fulfilled',
            amount_paid_minor: '12000',
            paid_at: '1794614400000',
          },
        ],
      },
    },
  })
  renderOrders()
  const row = await screen.findByRole('row', { name: /NEWEST/ })
  expect(within(row).getByText('Archived plan')).toBeVisible()
  expect(within(row).getByText(/¥\s*123\.45/)).toBeVisible()
  expect(within(row).getByText('Amount due')).toBeVisible()
  expect(within(row).getByText('9,007,199,254,740,993 / 7 / 11')).toBeVisible()
  expect(within(row).getByText('Pending payment')).toBeVisible()
  expect(
    screen
      .getAllByRole('row')
      .slice(1)
      .map((item) => item.textContent)
  ).toEqual([
    expect.stringContaining('NEWEST'),
    expect.stringContaining('OLDER'),
  ])
})
it('requests another page to make historical orders reachable', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockImplementation(async (_url, config) => ({
    data: {
      success: true,
      data: {
        page: (config?.params as { p: number } | undefined)?.p,
        page_size: 20,
        total: 21,
        items: [
          {
            ...order,
            trade_no:
              (config?.params as { p: number } | undefined)?.p === 2
                ? 'PAGE TWO'
                : 'PAGE ONE',
          },
        ],
      },
    },
  }))
  renderOrders()
  expect(await screen.findByText('PAGE ONE')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  expect(await screen.findByText('PAGE TWO')).toBeVisible()
  expect(api.get).toHaveBeenLastCalledWith('/api/custom_subscription/orders', {
    params: { p: 2, page_size: 20 },
  })
  expect(screen.queryByText('PAGE ONE')).not.toBeInTheDocument()
})
it('allows retry after backend failure and displays an authoritative empty state', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: { success: false, message: 'Order service unavailable' },
    })
    .mockResolvedValue({
      data: {
        success: true,
        data: { page: 1, page_size: 20, total: 0, items: [] },
      },
    })
  renderOrders()
  expect(await screen.findByText('Order service unavailable')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('No subscription orders')).toBeVisible()
})
it('never displays the previous viewer order while a new viewer request is pending', async () => {
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: { page: 1, page_size: 20, total: 1, items: [order] },
      },
    })
    .mockImplementation(() => new Promise(() => {}))
  renderOrders()
  expect(await screen.findByText('NEWEST')).toBeVisible()
  await act(async () =>
    useAuthStore.getState().auth.setUser({ id: 2, username: 'other', role: 1 })
  )
  expect(screen.queryByText('NEWEST')).not.toBeInTheDocument()
})

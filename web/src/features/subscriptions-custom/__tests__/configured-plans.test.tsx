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
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterContextProvider,
} from '@tanstack/react-router'
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'

import { SubscriptionsCustom } from '..'
import { configuredPlan, yearlyPlan } from './fixtures'

vi.mock('@/components/layout', () => ({
  PublicLayout: (props: { children: React.ReactNode }) => (
    <div>{props.children}</div>
  ),
}))
afterEach(() => {
  cleanup()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useLoginModalStore.getState().close()
})
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/subscription'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>
        <SubscriptionsCustom />
      </RouterContextProvider>
    </QueryClientProvider>
  )
  return client
}
function mockPlans(items: unknown[]) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: { items: url === '/api/custom_subscription/plans' ? items : [] },
    },
  }))
}
it('groups backend records by month/year and renders exact configured prices, points and benefits', async () => {
  mockPlans([yearlyPlan, configuredPlan])
  renderPage()
  const cards = await screen.findAllByRole('article')
  expect(cards).toHaveLength(2)
  expect(
    within(cards[0]).getByRole('heading', { name: configuredPlan.title })
  ).toBeVisible()
  expect(
    within(cards[1]).getByRole('heading', { name: yearlyPlan.title })
  ).toBeVisible()
  expect(within(cards[0]).getByText(configuredPlan.subtitle)).toBeVisible()
  expect(within(cards[0]).getByText('后台权益')).toBeVisible()
  expect(within(cards[0]).getByText('<script>literal</script>')).toBeVisible()
  expect(
    within(cards[0]).getAllByText(/9,007,199,254,740,993 通用积分/).length
  ).toBeGreaterThan(0)
  expect(within(cards[0]).getAllByText(/7 GPT积分/).length).toBeGreaterThan(0)
  expect(within(cards[0]).getByText(/12.5%/)).toBeVisible()
  expect(
    within(cards[0]).getByText('含额外赠送 1,125,899,906,842,625 GPT积分')
  ).toBeVisible()
  expect(
    within(cards[1]).getAllByText(/90,071,992,547,409.93/).length
  ).toBeGreaterThan(0)
  expect(screen.queryByText(/较逐月购买省2个月/)).not.toBeInTheDocument()
})
it('disables unavailable renewal and uses the selected database record in the purchase confirmation', async () => {
  const user = userEvent.setup()
  useAuthStore.getState().auth.setUser({ id: 1, username: 'buyer', role: 1 })
  mockPlans([yearlyPlan])
  const post = vi.spyOn(api, 'post')
  renderPage()
  const card = await screen.findByRole('article')
  expect(within(card).getByText('此方案暂未开放自动续费。')).toBeVisible()
  expect(within(card).getByRole('switch')).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  expect(
    within(card).getByRole('button', { name: /订阅并开启自动续费/ })
  ).toBeDisabled()
  await user.click(within(card).getByRole('button', { name: /单次购买/ }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByRole('heading', { level: 3 })).toHaveTextContent(
    '后台年付计划 · 年付'
  )
  expect(within(dialog).getByText(/本次支付/)).toHaveTextContent(
    '¥90,071,992,547,409.93'
  )
  expect(within(dialog).getByText(/365 天/)).toBeVisible()
  expect(within(dialog).queryByText(/演示|预览/)).not.toBeInTheDocument()
  expect(post).not.toHaveBeenCalled()
})
it('shows a distinct empty state without resurrecting sample offers', async () => {
  mockPlans([])
  renderPage()
  expect(await screen.findByText('暂无订阅计划')).toBeVisible()
  expect(screen.queryAllByRole('article')).toHaveLength(0)
})
it('shows pending data without sample offers', () => {
  vi.spyOn(api, 'get').mockImplementation((url) =>
    url === '/api/custom_subscription/plans'
      ? new Promise(() => {})
      : Promise.resolve({ data: { success: true, data: { items: [] } } })
  )
  renderPage()
  expect(screen.getByText('正在加载订阅计划…')).toBeVisible()
  expect(screen.queryAllByRole('article')).toHaveLength(0)
})
it('shows API failures and retries rather than converting failure into an empty catalog', async () => {
  const user = userEvent.setup()
  let failed = true
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data:
      url === '/api/custom_subscription/plans' && failed
        ? { success: false, message: 'Catalog unavailable' }
        : {
            success: true,
            data: {
              items:
                url === '/api/custom_subscription/plans'
                  ? [configuredPlan]
                  : [],
            },
          },
  }))
  renderPage()
  expect(await screen.findByText('Catalog unavailable')).toBeVisible()
  expect(screen.queryAllByRole('article')).toHaveLength(0)
  failed = false
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('article')).toHaveAccessibleName(
    /后台月付计划/
  )
})
it('uses no bonus for zero reward and discards a stale selection when a plan is removed', async () => {
  const user = userEvent.setup()
  mockPlans([
    {
      ...configuredPlan,
      bonus_points: '0',
      bonus_point_type: null,
      auto_renew_bonus_bps: 0,
      auto_bonus_point_type: null,
    },
  ])
  const client = renderPage()
  const card = await screen.findByRole('article')
  expect(within(card).queryByText(/10%|12.5%/)).not.toBeInTheDocument()
  await user.click(within(card).getByRole('switch'))
  await act(async () => {
    client.setQueryData(['subscription-plans', 'public'], [])
  })
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})
it('requires reconfirmation when the selected plan version and cycle change', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'buyer', role: 1 })
  const user = userEvent.setup()
  mockPlans([configuredPlan])
  const client = renderPage()
  const card = await screen.findByRole('article')
  await user.click(within(card).getByRole('button', { name: /单次购买/ }))
  await act(async () => {
    client.setQueryData(
      ['subscription-plans', 'public'],
      [{ ...yearlyPlan, id: configuredPlan.id, version: '2' }]
    )
  })
  const dialog = screen.getByRole('dialog')
  await waitFor(() =>
    expect(within(dialog).getByRole('heading', { level: 3 })).toHaveTextContent(
      '后台年付计划 · 年付'
    )
  )
})

it('uses the real enabled plan version as a required exact checkout identifier', async () => {
  mockPlans([{ ...configuredPlan, version: undefined }])
  renderPage()
  expect(await screen.findByText(/version/)).toBeVisible()
  expect(screen.queryAllByRole('article')).toHaveLength(0)
})

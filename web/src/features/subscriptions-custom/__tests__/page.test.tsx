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
  RouterProvider,
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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { Route as subscriptionRoute } from '@/routes/subscription'
import { useAuthStore } from '@/stores/auth-store'

import { SubscriptionsCustom } from '..'
import rules from '../rules.json'
import { configuredPlan } from './fixtures'

async function renderDemo() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/subscription'] }),
  })
  const view = render(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>
        <SubscriptionsCustom />
      </RouterContextProvider>
    </QueryClientProvider>
  )
  await screen.findAllByRole('article')
  return { ...view, router }
}
beforeEach(() => {
  const plans = [
    {
      id: '1',
      title: '月计划一',
      billing_cycle: 'month',
      duration_months: 1,
      paid_points: '29000',
    },
    {
      id: '2',
      title: '月计划二',
      billing_cycle: 'month',
      duration_months: 1,
      paid_points: '89000',
    },
    {
      id: '3',
      title: '月计划三',
      billing_cycle: 'month',
      duration_months: 1,
      paid_points: '199000',
    },
    {
      id: '4',
      title: '年计划一',
      billing_cycle: 'year',
      duration_months: 12,
      paid_points: '348000',
    },
    {
      id: '5',
      title: '年计划二',
      billing_cycle: 'year',
      duration_months: 12,
      paid_points: '1068000',
    },
    {
      id: '6',
      title: '年计划三',
      billing_cycle: 'year',
      duration_months: 12,
      paid_points: '2388000',
    },
  ].map((plan) => ({
    ...configuredPlan,
    bonus_points: '0',
    bonus_point_type: null,
    ...plan,
  }))
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    let data: unknown
    if (url === '/api/status') {
      data = {
        support_wecom: 'configured-wecom',
        operations_email: 'ops@example.com',
      }
    } else if (url === '/api/custom_subscription/self') {
      data = {
        active_subscription_id: null,
        observed_at: '1794614400000',
        items: [],
      }
    } else {
      const items =
        url === '/api/custom_subscription/plans'
          ? plans
          : rules.map((rule, index) => ({
              id: String(index + 1),
              rule_key: String(index),
              title: rule.title,
              content: {
                blocks: [
                  {
                    type: 'paragraph',
                    children: rule.body.map((part) => ({
                      text: part.text,
                      style: part.emphasis
                        ? { color: '#0052d9', fontWeight: 700 }
                        : {},
                    })),
                  },
                ],
              },
            }))
      data = { items }
    }
    return { data: { success: true, data } }
  })
})
vi.mock('@/components/layout', () => ({
  PublicLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock('@/components/layout/components/footer', () => ({
  Footer: () => <footer>自定义页脚</footer>,
}))
afterEach(() => {
  cleanup()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
})
function signIn() {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'demo', role: 1 })
}
it('renders footer columns and links common errors to the tutorial', async () => {
  const { router } = await renderDemo()
  const footer = within(screen.getByRole('contentinfo'))
  expect(footer.getByText('帮助')).toBeVisible()
  expect(footer.getByText('合作')).toBeVisible()
  expect(footer.getByText('© 2026 ZYY AI')).toBeVisible()
  expect(footer.getByRole('link', { name: '常见报错' })).toHaveAttribute(
    'href',
    '/tutorial'
  )
  await userEvent.click(footer.getByRole('link', { name: '常见报错' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/tutorial'))
})
it('opens customer support with configured contact details', async () => {
  const user = userEvent.setup()
  await renderDemo()
  await user.click(screen.getAllByRole('button', { name: '联系客服' })[0])
  const dialog = screen.getByRole('dialog', { name: '联系客服' })
  expect(within(dialog).getByText('企业微信（响应最快）')).toBeVisible()
  expect(
    within(dialog).getByRole('button', { name: '复制微信号' })
  ).toBeVisible()
  expect(within(dialog).getByText(/ops@example.com/)).toBeVisible()
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  await user.click(within(dialog).getByRole('button', { name: '复制微信号' }))
  expect(write).toHaveBeenCalledWith('configured-wecom')
  await user.click(within(dialog).getByRole('button', { name: '复制邮箱' }))
  expect(write).toHaveBeenCalledWith('ops@example.com')
  await user.click(within(dialog).getByRole('button', { name: '知道了' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('shows configured offers, exact annual points and all rules', async () => {
  await renderDemo()
  expect(screen.getByRole('contentinfo')).toBeVisible()
  expect(screen.getAllByRole('article')).toHaveLength(6)
  expect(screen.getAllByText(/2,388,000 通用积分/).length).toBeGreaterThan(0)
  expect(screen.getByRole('heading', { name: '订阅规则' })).toBeVisible()
})
it('keeps automatic renewal disabled without creating a simulated authorization', async () => {
  const user = userEvent.setup()
  await renderDemo()
  for (const toggle of screen.getAllByRole('switch')) {
    expect(toggle).toHaveAttribute('aria-disabled', 'true')
  }
  await user.click(screen.getAllByRole('switch')[0])
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getAllByRole('switch')[0]).toHaveAttribute(
    'aria-checked',
    'false'
  )
})
it('hides account-only tabs and sections for signed-out visitors', async () => {
  await renderDemo()
  expect(screen.queryByRole('tab', { name: '订单' })).toBeNull()
  expect(screen.queryByRole('tab', { name: '发票' })).toBeNull()
  expect(screen.queryByRole('heading', { name: '自动续费管理' })).toBeNull()
  expect(
    screen.queryByRole('heading', { name: '我的订阅与权益排期' })
  ).toBeNull()
  expect(screen.getByRole('heading', { name: '订阅规则' })).toBeVisible()
})
it('shows the current subscription and hides invoices and the top entitlement schedule when signed in', async () => {
  signIn()
  await renderDemo()
  expect(screen.getByRole('heading', { name: 'My subscription' })).toBeVisible()
  expect(screen.queryByRole('tab', { name: '发票' })).not.toBeInTheDocument()
  expect(
    screen.queryByRole('heading', { name: '我的订阅与权益排期' })
  ).not.toBeInTheDocument()
})

it('restores the default plans tab through browser back and the orders tab through forward', async () => {
  signIn()
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [],
        page: 1,
        page_size: 20,
        total: 0,
        active_subscription_id: null,
        observed_at: '1794614400000',
      },
    },
  })
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/subscription/',
    validateSearch: subscriptionRoute.options.validateSearch,
    component: subscriptionRoute.options.component,
  })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/subscription'] }),
  })
  await router.load()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  const user = userEvent.setup()
  expect(await screen.findByRole('tab', { name: '订阅服务' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await user.click(screen.getByRole('tab', { name: '订单' }))
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({ tab: 'orders' })
  )
  expect(screen.getByRole('tab', { name: '订单' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await act(async () => {
    router.history.back()
  })
  await waitFor(() =>
    expect(router.state.location.search).not.toHaveProperty('tab')
  )
  expect(screen.getByRole('tab', { name: '订阅服务' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await act(async () => {
    router.history.forward()
  })
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: '订单' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  )
})

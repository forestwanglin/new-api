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
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { SubscriptionsCustom } from '..'
import rules from '../rules.json'
import { configuredPlan } from './fixtures'

async function renderDemo() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <SubscriptionsCustom />
    </QueryClientProvider>
  )
  await screen.findAllByRole('article')
  return view
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
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: {
        items:
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
              })),
      },
    },
  }))
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
it('renders Demo footer columns, copyright and working FAQ', async () => {
  const user = userEvent.setup()
  await renderDemo()
  const footer = within(screen.getByRole('contentinfo'))
  expect(footer.getByText('帮助')).toBeVisible()
  expect(footer.getByText('合作')).toBeVisible()
  expect(footer.getByText('© 2026 ZYY AI')).toBeVisible()
  await user.click(footer.getByRole('button', { name: '常见报错' }))
  expect(screen.getByRole('dialog', { name: '常见报错' })).toBeVisible()
  expect(screen.getByText('认证失败 / 401')).toBeVisible()
})
it('opens customer support with the demo contact details', async () => {
  const user = userEvent.setup()
  await renderDemo()
  await user.click(screen.getAllByRole('button', { name: '联系客服' })[0])
  const dialog = screen.getByRole('dialog', { name: '联系客服' })
  expect(within(dialog).getByText('企业微信（响应最快）')).toBeVisible()
  expect(
    within(dialog).getByRole('button', { name: '复制微信号' })
  ).toBeVisible()
  expect(within(dialog).getByText(/support@ai.winzyy.com/)).toBeVisible()
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  await user.click(within(dialog).getByRole('button', { name: '复制微信号' }))
  expect(write).toHaveBeenCalledWith('zyy-ai-support')
  await user.click(within(dialog).getByRole('button', { name: '复制邮箱' }))
  expect(write).toHaveBeenCalledWith('support@ai.winzyy.com')
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
it('requires consent, simulates one renewal selection and never claims payment', async () => {
  const user = userEvent.setup()
  await renderDemo()
  await user.click(screen.getAllByRole('switch')[0])
  const dialog = screen.getByRole('dialog')
  expect(
    within(dialog).getByRole('button', { name: '确认演示' })
  ).toBeDisabled()
  await user.click(within(dialog).getByRole('checkbox'))
  await user.click(within(dialog).getByRole('button', { name: '确认演示' }))
  expect(screen.getAllByRole('switch')[0]).toHaveAttribute(
    'aria-checked',
    'true'
  )
  expect(screen.getByRole('status')).toHaveTextContent('未实际支付或开通订阅。')
})
it('replaces renewal selections, supports cancellation and resets on remount', async () => {
  const user = userEvent.setup()
  const view = await renderDemo()
  for (const index of [0, 1]) {
    await user.click(screen.getAllByRole('switch')[index])
    await user.click(within(screen.getByRole('dialog')).getByRole('checkbox'))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: '确认演示',
      })
    )
  }
  expect(
    screen
      .getAllByRole('switch')
      .filter((el) => el.getAttribute('aria-checked') === 'true')
  ).toHaveLength(1)
  expect(screen.getAllByRole('switch')[0]).toHaveAttribute(
    'aria-checked',
    'false'
  )
  await user.click(screen.getAllByRole('switch')[1])
  expect(screen.getAllByRole('switch')[1]).toHaveAttribute(
    'aria-checked',
    'false'
  )
  view.unmount()
  await renderDemo()
  expect(
    screen
      .getAllByRole('switch')
      .every((el) => el.getAttribute('aria-checked') === 'false')
  ).toBe(true)
})
it('cancels a purchase with Escape without enabling renewal', async () => {
  const user = userEvent.setup()
  await renderDemo()
  await user.click(screen.getAllByRole('switch')[0])
  await user.keyboard('{Escape}')
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
it('shows demo empty states rather than account records', async () => {
  const user = userEvent.setup()
  signIn()
  await renderDemo()
  expect(screen.getByRole('heading', { name: '自动续费管理' })).toBeVisible()
  expect(
    screen.getByRole('heading', { name: '我的订阅与权益排期' })
  ).toBeVisible()
  await user.click(screen.getByRole('tab', { name: '订单' }))
  expect(screen.getByText('暂无演示订阅订单。')).toBeVisible()
})

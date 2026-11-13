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
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'

import { SubscriptionsCustom } from '..'
import { configuredPlan } from './fixtures'

vi.mock('@/components/layout', () => ({
  PublicLayout: (props: { children: React.ReactNode }) => (
    <div>{props.children}</div>
  ),
}))
beforeEach(() => {
  sessionStorage.clear()
  useLoginModalStore.getState().close()
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    const items: Record<string, unknown[]> = {
      '/api/custom_subscription/plans': [configuredPlan],
      '/api/custom_subscription/payment_methods': [
        { type: 'alipay', name: '支付宝' },
        { type: 'wxpay', name: '微信支付' },
      ],
    }
    return {
      data: { success: true, data: { items: items[String(url)] ?? [] } },
    }
  })
})
afterEach(() => {
  cleanup()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useLoginModalStore.getState().close()
  sessionStorage.clear()
  vi.restoreAllMocks()
})
function renderPage(
  props: React.ComponentProps<typeof SubscriptionsCustom> = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <SubscriptionsCustom {...props} />
    </QueryClientProvider>
  )
  return client
}
function signIn() {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'buyer', role: 1 })
}
it('opens login before purchasing and resumes the selected offer after successful login', async () => {
  const user = userEvent.setup()
  const post = vi.spyOn(api, 'post')
  renderPage()
  await user.click(await screen.findByRole('button', { name: /单次购买/ }))
  expect(useLoginModalStore.getState().isOpen).toBe(true)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(post).not.toHaveBeenCalled()
  await act(async () => {
    signIn()
    useLoginModalStore.getState().close()
  })
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(/后台月付计划/)).toBeVisible()
  expect(within(dialog).queryByText(/演示|预览/)).not.toBeInTheDocument()
  expect(within(dialog).getByText(/30 天/)).toBeVisible()
})
it('does not reopen a canceled login intent on a later unrelated login', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: /单次购买/ }))
  await act(async () => useLoginModalStore.getState().close())
  await act(async () => signIn())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('submits configured wxpay with exact plan identity and navigates through the wallet payment form', async () => {
  signIn()
  const user = userEvent.setup()
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: {
        trade_no: 'CSO1',
        url: 'https://payments.example/submit',
        params: { out_trade_no: 'CSO1', type: 'wxpay' },
      },
    },
  })
  const submit = vi
    .spyOn(HTMLFormElement.prototype, 'submit')
    .mockImplementation(function (this: HTMLFormElement) {
      expect(this.action).toBe('https://payments.example/submit')
      expect(new FormData(this).get('type')).toBe('wxpay')
    })
  renderPage()
  await user.click(await screen.findByRole('button', { name: /单次购买/ }))
  const dialog = screen.getByRole('dialog')
  await user.click(
    await within(dialog).findByRole('combobox', { name: '支付方式' })
  )
  await user.click(await screen.findByRole('option', { name: '微信支付' }))
  await user.click(within(dialog).getByRole('button', { name: /支付 ¥/ }))
  await waitFor(() => expect(submit).toHaveBeenCalledOnce())
  expect(post).toHaveBeenCalledWith(
    '/api/custom_subscription/orders',
    expect.objectContaining({
      plan_id: configuredPlan.id,
      plan_version: configuredPlan.version,
      payment_method: 'wxpay',
      request_id: expect.any(String),
    })
  )
  expect(screen.getByText(/支付确认中/)).toBeVisible()
})
it('shows unavailable payments without creating an order and disables automatic renewal', async () => {
  signIn()
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: {
        items: url === '/api/custom_subscription/plans' ? [configuredPlan] : [],
      },
    },
  }))
  const post = vi.spyOn(api, 'post')
  renderPage()
  expect(await screen.findByRole('switch')).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  await user.click(screen.getByRole('button', { name: /单次购买/ }))
  expect(
    await screen.findByText('暂无可用支付方式，请联系客服。')
  ).toBeVisible()
  expect(
    within(screen.getByRole('dialog')).getByRole('button', { name: /支付 ¥/ })
  ).toBeDisabled()
  expect(post).not.toHaveBeenCalled()
})

it('renders actual active and paused subscriptions from the authenticated self query', async () => {
  signIn()
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    const items: Record<string, unknown[]> = {
      '/api/custom_subscription/plans': [configuredPlan],
      '/api/custom_subscription/self': [
        {
          id: '1',
          plan_id: configuredPlan.id,
          status: 'active',
          priority: 9,
          remaining_duration_ms: '2592000000',
        },
        {
          id: '2',
          plan_id: '42',
          status: 'paused',
          priority: 2,
          remaining_duration_ms: '86400000',
        },
      ],
    }
    return {
      data: { success: true, data: { items: items[String(url)] ?? [] } },
    }
  })
  renderPage()
  expect(await screen.findByText('使用中')).toBeVisible()
  expect(screen.getByText('已暂停')).toBeVisible()
  expect(screen.getByText('优先级 9')).toBeVisible()
  expect(screen.getByText('剩余服务时长 2,592,000 秒')).toBeVisible()
})
it('queries an already paid checkout replay without submitting a second payment form', async () => {
  signIn()
  const user = userEvent.setup()
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { trade_no: 'PAID1', status: 'success' } },
  })
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/custom_subscription/orders/PAID1') {
      return {
        data: {
          success: true,
          data: {
            trade_no: 'PAID1',
            status: 'success',
            fulfillment_status: 'fulfilled',
          },
        },
      }
    }
    const items: Record<string, unknown[]> = {
      '/api/custom_subscription/plans': [configuredPlan],
      '/api/custom_subscription/payment_methods': [
        { type: 'alipay', name: '支付宝' },
      ],
    }
    return {
      data: { success: true, data: { items: items[String(url)] ?? [] } },
    }
  })
  const submit = vi
    .spyOn(HTMLFormElement.prototype, 'submit')
    .mockImplementation(() => {})
  renderPage()
  await user.click(await screen.findByRole('button', { name: /单次购买/ }))
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: /支付 ¥/ })
  )
  expect(
    await screen.findByText('支付成功，积分已到账，订阅已按优先级安排。')
  ).toBeVisible()
  expect(submit).not.toHaveBeenCalled()
  expect(get).toHaveBeenCalledWith('/api/custom_subscription/orders/PAID1')
})
it('does not submit payment parameters from a request that completed after logout', async () => {
  signIn()
  const user = userEvent.setup()
  let complete: (value: unknown) => void = () => {}
  vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve
      })
  )
  const submit = vi
    .spyOn(HTMLFormElement.prototype, 'submit')
    .mockImplementation(() => {})
  renderPage()
  await user.click(await screen.findByRole('button', { name: /单次购买/ }))
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: /支付 ¥/ })
  )
  await act(async () => {
    useAuthStore.getState().auth.setUser(null)
  })
  await act(async () => {
    complete({
      data: {
        success: true,
        data: {
          trade_no: 'LATE',
          url: 'https://payments.example/submit',
          params: {},
        },
      },
    })
  })
  expect(submit).not.toHaveBeenCalled()
  expect(screen.queryByText('LATE')).not.toBeInTheDocument()
})

it('preserves the request identity for a failed checkout retry and blocks duplicate submission while pending', async () => {
  signIn()
  const user = userEvent.setup()
  let reject: (reason: Error) => void = () => {}
  const post = vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise
      })
  )
  renderPage()
  await user.click(await screen.findByRole('button', { name: /单次购买/ }))
  const pay = within(screen.getByRole('dialog')).getByRole('button', {
    name: /支付 ¥/,
  })
  await user.dblClick(pay)
  expect(post).toHaveBeenCalledOnce()
  expect(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: '正在发起支付…',
    })
  ).toBeDisabled()
  const originalRequest = post.mock.calls[0][1]
  await act(async () => reject(new Error('Payment unavailable')))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Payment unavailable'
  )
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: /支付 ¥/ })
  )
  expect(post.mock.calls[1][1]).toEqual(originalRequest)
})

it('requires an explicit confirmation of a new plan version before allowing payment', async () => {
  signIn()
  const user = userEvent.setup()
  const client = renderPage()
  await user.click(await screen.findByRole('button', { name: /单次购买/ }))
  await act(async () =>
    client.setQueryData(
      ['subscription-plans', 'public'],
      [{ ...configuredPlan, version: '2', price_amount_minor: '23456' }]
    )
  )
  const dialog = screen.getByRole('dialog')
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', { name: /支付 ¥/ })
    ).toBeDisabled()
  )
  await user.click(
    within(dialog).getByRole('button', {
      name: '方案已更新，请重新确认价格和积分。',
    })
  )
  expect(within(dialog).getByRole('button', { name: /支付 ¥/ })).toBeEnabled()
})

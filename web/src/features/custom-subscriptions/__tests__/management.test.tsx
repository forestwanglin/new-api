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
import { render, screen, within, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { CustomSubscriptions } from '..'
import type { CustomSubscriptionPlan } from '../types'

const plan: CustomSubscriptionPlan = {
  id: '1',
  version: '3',
  code: 'basic',
  title: 'Basic plan',
  subtitle: '',
  tier_code: 'basic',
  tier_rank: 1,
  billing_cycle: 'month',
  duration_months: 1,
  currency: 'CNY',
  price_amount_minor: '29',
  paid_points: '9007199254740993',
  paid_point_type_id: '1',
  bonus_points: '0',
  bonus_point_type_id: null,
  auto_renew_enabled: false,
  auto_renew_bonus_bps: 0,
  auto_bonus_point_type_id: null,
  benefits: ['Full benefit'],
  enabled: true,
  sort_order: 0,
  created_at: 1000,
  updated_at: 2000,
  paid_point_type: { id: '1', code: 'GENERAL', name: 'General' },
  bonus_point_type: null,
  auto_bonus_point_type: null,
}
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <CustomSubscriptions />
    </QueryClientProvider>
  )
  return client
}
beforeEach(() => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 10 })
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/1')
        ? plan
        : {
            page: 1,
            page_size: 20,
            total: 1,
            items: [plan],
            point_types: [plan.paid_point_type],
          },
    },
  }))
})
afterEach(() => useAuthStore.getState().auth.reset())

describe('custom subscription management', () => {
  it('keeps large points exact and shows detail benefits; Escape closes the drawer', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('9,007,199,254,740,993')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'View details' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Full benefit')).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
  })
  it('keeps entered values on server failure and refreshes after a successful edit', async () => {
    const user = userEvent.setup()
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValueOnce({
        data: {
          success: false,
          message: 'Custom subscription plan version conflict',
        },
      })
      .mockResolvedValue({ data: { success: true, data: plan } })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const title = await screen.findByRole('textbox', { name: 'Plan name' })
    await user.clear(title)
    await user.type(title, 'Changed title')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(
      await screen.findByText('Custom subscription plan version conflict')
    ).toBeVisible()
    expect(title).toHaveValue('Changed title')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(put).toHaveBeenLastCalledWith(
      expect.stringContaining('/1'),
      expect.objectContaining({
        title: 'Changed title',
        version: '3',
        auto_renew_enabled: false,
        bonus_points: '0',
      })
    )
    expect(api.get).toHaveBeenCalledWith(
      '/api/custom_subscription/admin/plans',
      expect.anything()
    )
  })
  it('cancels deletion without writing and displays order protection on rejection', async () => {
    const user = userEvent.setup()
    const remove = vi.spyOn(api, 'delete').mockResolvedValue({
      data: {
        success: false,
        message: 'Plan has orders; disable it instead',
      },
    })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(
      await screen.findByText('Plan has orders; disable it instead')
    ).toBeVisible()
    expect(dialog).toBeVisible()
  })
  it('blocks creation when catalog loading failed and offers retry instead of a successful empty state', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Catalog unavailable'))
    renderPage()
    expect(await screen.findByText('Catalog unavailable')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create plan' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(
      screen.queryByText('No custom subscription plans')
    ).not.toBeInTheDocument()
  })
  it('creates a new plan without commercial defaults and clears unused bonus configuration', async () => {
    const user = userEvent.setup()
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true, data: plan } })
    renderPage()
    await screen.findByText('Basic plan')
    await user.click(screen.getByRole('button', { name: 'Create plan' }))
    expect(
      screen.getByRole('textbox', { name: 'Price (CNY yuan)' })
    ).toHaveValue('')
    for (const [label, value] of [
      ['Plan code', 'new-plan'],
      ['Plan name', 'New plan'],
      ['Tier code', 'basic'],
      ['Price (CNY yuan)', '0.29'],
      ['Paid points', '101'],
    ]) {
      await user.type(screen.getByRole('textbox', { name: label }), value)
    }
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Paid point type' }),
      '1'
    )
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(post).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        code: 'new-plan',
        price_amount_minor: '29',
        paid_points: '101',
        auto_renew_enabled: false,
        auto_renew_bonus_bps: 0,
        bonus_point_type_id: null,
      })
    )
  })
})

describe('custom subscription list controls', () => {
  it('resets server pagination for keyword, status and cycle filters', async () => {
    const user = userEvent.setup()
    vi.mocked(api.get).mockImplementation(async () => ({
      data: {
        success: true,
        data: {
          page: 1,
          page_size: 20,
          total: 41,
          items: [plan],
          point_types: [plan.paid_point_type],
        },
      },
    }))
    renderPage()
    await user.click(
      await screen.findByRole('button', { name: 'Go to next page' })
    )
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(expect.anything(), {
        params: expect.objectContaining({ p: 2 }),
      })
    )
    await user.type(
      screen.getByPlaceholderText('Search plan name or code...'),
      'basic'
    )
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(expect.anything(), {
        params: expect.objectContaining({ p: 1, keyword: 'basic' }),
      })
    )
    await user.click(screen.getByRole('button', { name: 'Go to next page' }))
    await user.click(screen.getByRole('button', { name: 'Status' }))
    await user.click(await screen.findByRole('option', { name: 'Disabled' }))
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(expect.anything(), {
        params: expect.objectContaining({ p: 1, enabled: 'false' }),
      })
    )
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Billing cycle' }))
    await user.click(await screen.findByRole('option', { name: 'Yearly' }))
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(expect.anything(), {
        params: expect.objectContaining({
          p: 1,
          enabled: 'false',
          billing_cycle: 'year',
        }),
      })
    )
  })
  it('disables a plan with the latest version and retains exact values', async () => {
    const user = userEvent.setup()
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: { success: true, data: { ...plan, enabled: false } },
    })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Disable' }))
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/api/custom_subscription/admin/plans/1',
        expect.objectContaining({
          enabled: false,
          version: '3',
          paid_points: '9007199254740993',
          price_amount_minor: '29',
        })
      )
    )
  })
  it('returns to the previous page after deleting its last plan', async () => {
    const user = userEvent.setup()
    let removed = false
    vi.mocked(api.get).mockImplementation(async () => ({
      data: {
        success: true,
        data: {
          page: 1,
          page_size: 20,
          total: removed ? 20 : 21,
          items: removed ? [] : [plan],
          point_types: [plan.paid_point_type],
        },
      },
    }))
    vi.spyOn(api, 'delete').mockImplementation(async () => {
      removed = true
      return { data: { success: true } }
    })
    renderPage()
    await user.click(
      await screen.findByRole('button', { name: 'Go to next page' })
    )
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(expect.anything(), {
        params: expect.objectContaining({ p: 2 }),
      })
    )
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete',
      })
    )
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(expect.anything(), {
        params: expect.objectContaining({ p: 1 }),
      })
    )
    expect(
      await screen.findByText('No custom subscription plans')
    ).toBeVisible()
  })
  it('contains the wide table and wraps long names inside its scroll container', async () => {
    const longTitle = '测试🚀'.repeat(40)
    vi.mocked(api.get).mockResolvedValue({
      data: {
        success: true,
        data: {
          page: 1,
          page_size: 20,
          total: 1,
          items: [{ ...plan, title: longTitle }],
          point_types: [plan.paid_point_type],
        },
      },
    })
    renderPage()
    const title = await screen.findByText(longTitle)
    expect(title.parentElement).toHaveClass(
      'whitespace-normal',
      '[overflow-wrap:anywhere]'
    )
    const table = screen.getByRole('table')
    expect(table.parentElement).toHaveClass('overflow-auto')
    expect(table.closest('.max-w-full')).toHaveClass('min-w-0')
  })
})

describe('custom subscription language response', () => {
  it('reformats amounts after changing the interface language', async () => {
    renderPage()
    expect(await screen.findByText('¥ 0.29')).toBeVisible()
    await act(async () => {
      await i18next.changeLanguage('fr')
    })
    expect(await screen.findByText('¥ 0,29')).toBeVisible()
    await act(async () => {
      await i18next.changeLanguage('en')
    })
  })
})

describe('custom subscription form safeguards', () => {
  it('preserves an open form but blocks saving after a catalog refresh fails', async () => {
    const user = userEvent.setup()
    const client = renderPage()
    await user.click(await screen.findByRole('button', { name: 'Create plan' }))
    const title = screen.getByRole('textbox', { name: 'Plan name' })
    await user.type(title, 'Unsaved title')
    vi.mocked(api.get).mockRejectedValue(new Error('Directory refresh failed'))
    await act(async () => {
      await client.invalidateQueries({
        queryKey: ['custom-subscriptions', '1', 'list'],
      })
    })
    expect(title).toHaveValue('Unsaved title')
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save changes' })
      ).toBeDisabled()
    )
    expect(
      screen.getByText('Point type catalog unavailable. Retry before saving.')
    ).toBeVisible()
  })
  it('clears zero regular bonus type but preserves automatic rewards when the switch is disabled', async () => {
    const user = userEvent.setup()
    const bonusPlan = {
      ...plan,
      paid_points: '101',
      bonus_points: '2',
      bonus_point_type_id: '1',
      auto_renew_enabled: true,
      auto_renew_bonus_bps: 1000,
      auto_bonus_point_type_id: '1',
    }
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: {
        success: true,
        data: url.endsWith('/1')
          ? bonusPlan
          : {
              page: 1,
              page_size: 20,
              total: 1,
              items: [bonusPlan],
              point_types: [plan.paid_point_type],
            },
      },
    }))
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true, data: plan } })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const bonus = await screen.findByRole('textbox', {
      name: 'Regular bonus points',
    })
    await user.clear(bonus)
    await user.type(bonus, '0')
    await user.click(screen.getByRole('switch', { name: 'Automatic renewal' }))
    expect(
      screen.getByRole('combobox', { name: 'Regular bonus point type' })
    ).toBeDisabled()
    expect(
      screen.getByRole('textbox', {
        name: 'Automatic renewal bonus (basis points)',
      })
    ).toHaveValue('1000')
    expect(
      screen.getByRole('combobox', {
        name: 'Automatic renewal bonus point type',
      })
    ).toHaveValue('1')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          bonus_points: '0',
          bonus_point_type_id: null,
          auto_renew_enabled: false,
          auto_renew_bonus_bps: 1000,
          auto_bonus_point_type_id: '1',
        })
      )
    )
  })
})

describe('custom subscription standard administrator pagination', () => {
  it('offers page size, numbered pages and first/last controls with server pagination', async () => {
    const user = userEvent.setup()
    vi.mocked(api.get).mockResolvedValue({
      data: {
        success: true,
        data: {
          page: 1,
          page_size: 20,
          total: 120,
          items: [plan],
          point_types: [plan.paid_point_type],
        },
      },
    })
    renderPage()
    const pageSize = await screen.findByRole('combobox')
    expect(pageSize).toHaveTextContent('20')
    expect(
      screen.getByRole('button', { name: 'Go to first page' })
    ).toBeDisabled()
    await user.click(
      await screen.findByRole('button', { name: /Go to page 2/ })
    )
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(expect.anything(), {
        params: expect.objectContaining({ p: 2, page_size: 20 }),
      })
    )
    await user.click(pageSize)
    await user.click(await screen.findByRole('option', { name: '50' }))
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(expect.anything(), {
        params: expect.objectContaining({ p: 1, page_size: 50 }),
      })
    )
    await user.click(screen.getByRole('button', { name: 'Go to last page' }))
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(expect.anything(), {
        params: expect.objectContaining({ p: 3, page_size: 50 }),
      })
    )
    expect(
      screen.getByRole('button', { name: 'Go to next page' })
    ).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Go to first page' }))
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(expect.anything(), {
        params: expect.objectContaining({ p: 1, page_size: 50 }),
      })
    )
  })
})

describe('automatic renewal rewards without automatic renewal', () => {
  it('lets a new plan configure and submit rewards while its default switch remains off', async () => {
    const user = userEvent.setup()
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true, data: plan } })
    renderPage()
    await screen.findByText('Basic plan')
    await user.click(screen.getByRole('button', { name: 'Create plan' }))
    const rewardRate = screen.getByRole('textbox', {
      name: 'Automatic renewal bonus (basis points)',
    })
    expect(
      screen.getByRole('switch', { name: 'Automatic renewal' })
    ).not.toBeChecked()
    expect(rewardRate).toBeEnabled()
    for (const [label, value] of [
      ['Plan code', 'reward-preview'],
      ['Plan name', 'Preview'],
      ['Tier code', 'basic'],
      ['Price (CNY yuan)', '0.29'],
      ['Paid points', '101'],
    ]) {
      await user.type(screen.getByRole('textbox', { name: label }), value)
    }
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Paid point type' }),
      '1'
    )
    await user.clear(rewardRate)
    await user.type(rewardRate, '1250')
    const rewardType = screen.getByRole('combobox', {
      name: 'Automatic renewal bonus point type',
    })
    expect(rewardType).toBeEnabled()
    await user.selectOptions(rewardType, '1')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          auto_renew_enabled: false,
          auto_renew_bonus_bps: 1250,
          auto_bonus_point_type_id: '1',
        })
      )
    )
  })
  it('shows configured rewards in the disabled list, details and editable form', async () => {
    const user = userEvent.setup()
    const rewardPlan = {
      ...plan,
      paid_points: '101',
      bonus_points: '2',
      bonus_point_type_id: '1',
      auto_renew_bonus_bps: 1000,
      auto_bonus_point_type_id: '1',
      auto_bonus_point_type: {
        id: '1',
        code: 'GENERAL',
        name: 'Reward preview',
      },
    }
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: {
        success: true,
        data: url.endsWith('/1')
          ? rewardPlan
          : {
              page: 1,
              page_size: 20,
              total: 1,
              items: [rewardPlan],
              point_types: [plan.paid_point_type],
            },
      },
    }))
    renderPage()
    expect(await screen.findByText('10% · Reward preview')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'View details' }))
    const details = await screen.findByRole('dialog')
    expect(
      await within(details).findByText('Reward preview (GENERAL)')
    ).toBeVisible()
    expect(
      within(details).getByText('Automatic renewal extra points').parentElement
    ).toHaveTextContent('10')
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const rewardRate = await screen.findByRole('textbox', {
      name: 'Automatic renewal bonus (basis points)',
    })
    expect(rewardRate).toBeEnabled()
    expect(rewardRate).toHaveValue('1000')
    expect(
      screen.getByRole('combobox', {
        name: 'Automatic renewal bonus point type',
      })
    ).toHaveValue('1')
    await user.clear(rewardRate)
    await user.type(rewardRate, '0')
    expect(
      screen.getByRole('combobox', {
        name: 'Automatic renewal bonus point type',
      })
    ).toHaveValue('')
    expect(
      screen.getByRole('combobox', {
        name: 'Automatic renewal bonus point type',
      })
    ).toBeDisabled()
  })
})

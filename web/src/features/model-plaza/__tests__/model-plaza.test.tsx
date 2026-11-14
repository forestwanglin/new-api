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
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { PricingData } from '@/features/pricing/types'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  DEFAULT_MODEL_REFERENCE_EXCHANGE_RATE,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { ModelPlaza } from '..'

vi.mock('@/components/layout', () => ({
  PublicLayout: (props: { children: React.ReactNode }) => (
    <div>{props.children}</div>
  ),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: (props: { to: string; children?: React.ReactNode }) => (
    <a href={props.to}>{props.children}</a>
  ),
}))

const pricing: PricingData = {
  success: true,
  data: [
    {
      id: 1,
      model_name: 'deepseek-chat',
      description: 'General conversation',
      vendor_id: 11,
      quota_type: 0,
      model_ratio: 1,
      completion_ratio: 4,
      enable_groups: ['default'],
    },
    {
      id: 2,
      model_name: 'gpt-api-model',
      description: 'Code review',
      vendor_id: 22,
      quota_type: 0,
      model_ratio: 2,
      completion_ratio: 3,
      enable_groups: ['default'],
    },
    {
      id: 3,
      model_name: 'sd2.0-720P',
      description: 'Video generation',
      vendor_id: 11,
      quota_type: 1,
      model_price: 0.3,
      model_ratio: 0,
      completion_ratio: 0,
      enable_groups: ['default'],
      supported_endpoint_types: ['openai-video'],
    },
    {
      id: 4,
      model_name: 'tiered-api-model',
      description: 'Dynamic tokens',
      vendor_id: 22,
      quota_type: 0,
      model_ratio: 0,
      completion_ratio: 0,
      billing_mode: 'tiered_expr',
      billing_expr: 'tier("standard", p * 5 + c * 15)',
      enable_groups: ['default'],
    },
  ],
  vendors: [
    { id: 11, name: 'DeepSeek' },
    { id: 22, name: 'OpenAI' },
  ],
  group_ratio: { default: 1 },
  usable_group: { default: { desc: 'Default', ratio: 1 } },
  supported_endpoint: {},
  auto_groups: [],
}

let client: QueryClient
beforeEach(() => {
  useAuthStore.getState().auth.reset()
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType: 'USD' },
    modelReferenceExchangeRate: DEFAULT_MODEL_REFERENCE_EXCHANGE_RATE,
  })
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  client.setQueryData(['status'], {
    price: 1,
    usd_exchange_rate: 7,
    quota_display_type: 'USD',
  })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/status') {
      return { data: { success: true, price: 1, usd_exchange_rate: 7 } }
    }
    if (url === '/api/model/pricing') return { data: pricing }
    throw new Error(`Unexpected endpoint: ${url}`)
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  useLoginModalStore.getState().close()
  useAuthStore.getState().auth.reset()
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG },
    modelReferenceExchangeRate: DEFAULT_MODEL_REFERENCE_EXCHANGE_RATE,
  })
})

function renderPlaza() {
  return render(
    <QueryClientProvider client={client}>
      <ModelPlaza />
    </QueryClientProvider>
  )
}

it('renders only API models and uses the original token, video and expression prices', async () => {
  renderPlaza()
  const token = within(
    await screen.findByRole('row', { name: /deepseek-chat/ })
  )
  expect(token.getByText('2')).toBeVisible()
  expect(token.getByText('8')).toBeVisible()
  expect(token.getByText('USD / 1M tokens')).toBeVisible()
  expect(screen.getByText('General conversation')).toBeVisible()
  const video = within(screen.getByRole('row', { name: /sd2.0-720P/ }))
  expect(video.getByText('¥0.3')).toBeVisible()
  const dynamic = within(screen.getByRole('row', { name: /tiered-api-model/ }))
  expect(dynamic.getByText('5')).toBeVisible()
  expect(dynamic.getByText('15')).toBeVisible()
  expect(screen.queryByText('deepseek-v4.1-flash')).not.toBeInTheDocument()
  expect(
    screen.queryByText('比官网省', { exact: false })
  ).not.toBeInTheDocument()
})

it('counts every API model including video under its vendor and combines vendor and search filters', async () => {
  const user = userEvent.setup()
  renderPlaza()
  const sidebar = screen.getByRole('complementary', { name: 'Vendors' })
  const deepseek = await within(sidebar).findByRole('button', {
    name: /DeepSeek/,
  })
  expect(within(deepseek).getByText('2')).toBeVisible()
  await user.click(deepseek)
  expect(deepseek).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('sd2.0-720P')).toBeVisible()
  expect(screen.queryByText('gpt-api-model')).not.toBeInTheDocument()
  await user.type(
    screen.getByRole('textbox', { name: 'Search models' }),
    'video'
  )
  expect(screen.getByText('sd2.0-720P')).toBeVisible()
  expect(screen.queryByText('deepseek-chat')).not.toBeInTheDocument()
  await user.click(within(sidebar).getByRole('button', { name: /^All Models/ }))
  await user.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(screen.getByText('gpt-api-model')).toBeVisible()
})

it('offers an API-returned overseas model and opens login for anonymous use', async () => {
  renderPlaza()
  const row = within(await screen.findByRole('row', { name: /gpt-api-model/ }))
  await userEvent.setup().click(row.getByRole('button', { name: 'Use model' }))
  expect(useLoginModalStore.getState().isOpen).toBe(true)
  expect(useLoginModalStore.getState().redirectTo).toBe('/keys')
})

it('shows a loading state instead of an empty catalog while the request is pending', () => {
  vi.mocked(api.get).mockImplementation(() => new Promise(() => {}))
  renderPlaza()
  expect(screen.getByText('Loading...')).toBeVisible()
  expect(screen.queryByText('No models found')).not.toBeInTheDocument()
})

it('shows request errors and retries the independent public endpoint', async () => {
  let failed = true
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/api/status') return { data: { success: true } }
    if (failed) {
      return {
        data: { success: false, message: 'Pricing temporarily unavailable' },
      }
    }
    return { data: pricing }
  })
  renderPlaza()
  expect(
    await screen.findByText('Pricing temporarily unavailable')
  ).toBeVisible()
  failed = false
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('deepseek-chat')).toBeVisible()
})

it('shows no models when the API returns an empty list without falling back to the static catalog', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { ...pricing, data: [] } })
  renderPlaza()
  expect(await screen.findByText('No models found')).toBeVisible()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(screen.queryByText('deepseek-v4.1-flash')).not.toBeInTheDocument()
})

it('reloads group-scoped models after login instead of retaining the anonymous cache', async () => {
  renderPlaza()
  await screen.findByText('deepseek-chat')
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...pricing,
      data: [{ ...pricing.data[0], model_name: 'member-only-model' }],
    },
  })
  act(() =>
    useAuthStore
      .getState()
      .auth.setUser({ id: 7, username: 'member', role: 1, group: 'vip' })
  )
  expect(await screen.findByText('member-only-model')).toBeVisible()
  expect(screen.queryByText('deepseek-chat')).not.toBeInTheDocument()
  const row = within(screen.getByRole('row', { name: /member-only-model/ }))
  expect(row.getByRole('link', { name: 'Use model' })).toHaveAttribute(
    'href',
    '/keys'
  )
})

it('groups API vendors into clickable domestic and overseas categories', async () => {
  const user = userEvent.setup()
  renderPlaza()
  const sidebar = screen.getByRole('complementary', { name: 'Vendors' })
  const domestic = await within(sidebar).findByRole('button', {
    name: /^Domestic Models/,
  })
  const overseas = within(sidebar).getByRole('button', {
    name: /^Overseas Models/,
  })
  expect(within(domestic).getByText('2')).toBeVisible()
  expect(within(overseas).getByText('2')).toBeVisible()
  expect(
    within(sidebar).queryByRole('button', { name: /^Other Models/ })
  ).not.toBeInTheDocument()
  await user.click(domestic)
  expect(domestic).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('heading', { name: 'Domestic Models' })).toBeVisible()
  expect(screen.getByText('deepseek-chat')).toBeVisible()
  expect(screen.getByText('sd2.0-720P')).toBeVisible()
  expect(screen.queryByText('gpt-api-model')).not.toBeInTheDocument()
  await user.click(overseas)
  expect(overseas).toHaveAttribute('aria-pressed', 'true')
  expect(domestic).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByText('gpt-api-model')).toBeVisible()
  expect(screen.queryByText('deepseek-chat')).not.toBeInTheDocument()
})

it('uses vendor aliases without binding classification to a fixed database ID', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...pricing,
      data: [
        { ...pricing.data[0], model_name: 'alias-domestic', vendor_id: 101 },
        { ...pricing.data[0], model_name: 'chinese-domestic', vendor_id: 202 },
        { ...pricing.data[0], model_name: 'alias-overseas', vendor_id: -303 },
      ],
      vendors: [
        { id: 101, name: '  zHiPu  ' },
        { id: 202, name: '通义千问' },
        { id: -303, name: 'claude' },
      ],
    },
  })
  const user = userEvent.setup()
  renderPlaza()
  const domestic = await screen.findByRole('button', {
    name: /^Domestic Models/,
  })
  expect(within(domestic).getByText('2')).toBeVisible()
  await user.click(domestic)
  expect(screen.getByText('alias-domestic')).toBeVisible()
  expect(screen.getByText('chinese-domestic')).toBeVisible()
  expect(screen.queryByText('alias-overseas')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /^claude/ }))
  expect(screen.getByText('alias-overseas')).toBeVisible()
  expect(screen.queryByText('alias-domestic')).not.toBeInTheDocument()
})

it('keeps missing and unrecognized vendors in other models while a custom name with a known vendor follows its vendor', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...pricing,
      data: [
        { ...pricing.data[0], model_name: 'code-auto-review', vendor_id: 0 },
        { ...pricing.data[0], model_name: 'custom-service', vendor_id: 99 },
        {
          ...pricing.data[0],
          model_name: 'code-auto-review-openai',
          vendor_id: 22,
        },
      ],
      vendors: [...pricing.vendors, { id: 99, name: 'Private Service' }],
    },
  })
  const user = userEvent.setup()
  renderPlaza()
  const other = await screen.findByRole('button', { name: /^Other Models/ })
  expect(within(other).getByText('2')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: /^Domestic Models/ })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /^Unknown/ })
  ).not.toBeInTheDocument()
  await user.click(other)
  expect(screen.getByText('code-auto-review')).toBeVisible()
  expect(screen.getByText('custom-service')).toBeVisible()
  expect(screen.queryByText('code-auto-review-openai')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /^Overseas Models/ }))
  expect(screen.getByText('code-auto-review-openai')).toBeVisible()
})

it('updates category and vendor counts for search without hiding categories with no matches', async () => {
  const user = userEvent.setup()
  renderPlaza()
  const sidebar = screen.getByRole('complementary', { name: 'Vendors' })
  const domestic = await within(sidebar).findByRole('button', {
    name: /^Domestic Models/,
  })
  await user.click(domestic)
  await user.type(
    screen.getByRole('textbox', { name: 'Search models' }),
    'video'
  )
  expect(within(domestic).getByText('1')).toBeVisible()
  expect(
    within(
      within(sidebar).getByRole('button', { name: /^DeepSeek/ })
    ).getByText('1')
  ).toBeVisible()
  expect(
    within(
      within(sidebar).getByRole('button', { name: /^Overseas Models/ })
    ).getByText('0')
  ).toBeVisible()
  expect(
    within(
      within(sidebar).getByRole('button', { name: /^All Models/ })
    ).getByText('1')
  ).toBeVisible()
  expect(screen.getByText('sd2.0-720P')).toBeVisible()
  await user.click(
    within(sidebar).getByRole('button', { name: /^Overseas Models/ })
  )
  expect(screen.getByText('No models found')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Overseas Models' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Clear all filters' }))
  expect(screen.getByRole('textbox', { name: 'Search models' })).toHaveValue('')
  expect(
    within(sidebar).getByRole('button', { name: /^All Models/ })
  ).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('deepseek-chat')).toBeVisible()
  expect(screen.getByText('gpt-api-model')).toBeVisible()
})

it('allows keyboard selection of a category and keeps it selected when search has no matches', async () => {
  const user = userEvent.setup()
  renderPlaza()
  const domestic = await screen.findByRole('button', {
    name: /^Domestic Models/,
  })
  domestic.focus()
  await user.keyboard('{Enter}')
  expect(domestic).toHaveAttribute('aria-pressed', 'true')
  await user.type(
    screen.getByRole('textbox', { name: 'Search models' }),
    'nonexistent-model'
  )
  expect(domestic).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('No models found')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Clear all filters' }))
  expect(screen.getByRole('button', { name: /^All Models/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
})

it('keeps sale prices and domestic references unchanged while multiplying overseas references by seven', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: { ...pricing, group_ratio: { default: 0.5 } },
  })
  renderPlaza()
  const domestic = within(
    await screen.findByRole('row', { name: /deepseek-chat/ })
  )
  expect(domestic.getByText('1')).toBeVisible()
  expect(domestic.getByLabelText('Original price 2')).toBeVisible()
  expect(domestic.getByLabelText('Original price 8')).toBeVisible()
  const overseas = within(screen.getByRole('row', { name: /gpt-api-model/ }))
  expect(overseas.getByText('2')).toBeVisible()
  expect(overseas.getByText('6')).toBeVisible()
  expect(overseas.getByLabelText('Original price 28')).toBeVisible()
  expect(overseas.getByLabelText('Original price 84')).toBeVisible()
  expect(
    overseas.getByText('Save 93% compared with the official website')
  ).toBeVisible()
  expect(
    domestic.getByText('Save 50% compared with the official website')
  ).toBeVisible()
  const columns = screen.getAllByRole('columnheader')
  expect(columns.at(-1)).toHaveTextContent('Discount ratio')
})

it('keeps the headline lowest discount across all models when the list is filtered', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: { ...pricing, group_ratio: { default: 0.5 } },
  })
  renderPlaza()
  const promotion = await screen.findByRole('status', {
    name: 'Model discount',
  })
  expect(promotion).toHaveTextContent('Save up to 93%')
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: /^Domestic Models/ }))
  expect(screen.queryByText('gpt-api-model')).not.toBeInTheDocument()
  expect(promotion).toHaveTextContent('Save up to 93%')
  expect(
    screen.getByText(
      'Overseas reference prices used for discount comparisons are converted at a reference rate of USD 1 = CNY 7. This rate is for display only and does not change billing.'
    )
  ).toBeVisible()
})

it('shows overseas references without changing full-rate token or expression sale prices', async () => {
  renderPlaza()
  const overseas = within(
    await screen.findByRole('row', { name: /gpt-api-model/ })
  )
  expect(overseas.getByText('4')).toBeVisible()
  expect(overseas.getByText('12')).toBeVisible()
  expect(overseas.getByLabelText('Original price 28')).toBeVisible()
  expect(overseas.getByLabelText('Original price 84')).toBeVisible()
  const dynamic = within(screen.getByRole('row', { name: /tiered-api-model/ }))
  expect(dynamic.getByText('5')).toBeVisible()
  expect(dynamic.getByText('15')).toBeVisible()
  expect(dynamic.getByLabelText('Original price 35')).toBeVisible()
  expect(dynamic.getByLabelText('Original price 105')).toBeVisible()
})

it('reacts to the configured reference exchange rate in overseas prices, discounts and explanation only', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: { ...pricing, group_ratio: { default: 0.5 } },
  })
  renderPlaza()
  await screen.findByRole('row', { name: /gpt-api-model/ })
  act(() =>
    useSystemConfigStore.getState().setConfig({ modelReferenceExchangeRate: 5 })
  )
  const overseas = within(screen.getByRole('row', { name: /gpt-api-model/ }))
  expect(overseas.getByText('2')).toBeVisible()
  expect(overseas.getByText('6')).toBeVisible()
  expect(overseas.getByLabelText('Original price 20')).toBeVisible()
  expect(overseas.getByLabelText('Original price 60')).toBeVisible()
  expect(
    overseas.getByText('Save 90% compared with the official website')
  ).toBeVisible()
  expect(
    screen.getByRole('status', { name: 'Model discount' })
  ).toHaveTextContent('Save up to 90%')
  const domestic = within(screen.getByRole('row', { name: /deepseek-chat/ }))
  expect(domestic.getByLabelText('Original price 2')).toBeVisible()
  expect(
    domestic.getByText('Save 50% compared with the official website')
  ).toBeVisible()
  expect(
    screen.getByText(
      'Overseas reference prices used for discount comparisons are converted at a reference rate of USD 1 = CNY 5. This rate is for display only and does not change billing.'
    )
  ).toBeVisible()
})

it('shows codex-auto-review in the overseas filter without vendor metadata', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...pricing,
      data: [
        { ...pricing.data[0], model_name: 'codex-auto-review', vendor_id: 0 },
        { ...pricing.data[0], model_name: 'custom-service', vendor_id: 99 },
      ],
      vendors: [{ id: 99, name: 'Private Service' }],
    },
  })
  const user = userEvent.setup()
  renderPlaza()
  const overseas = await screen.findByRole('button', {
    name: /^Overseas Models/,
  })
  expect(within(overseas).getByText('1')).toBeVisible()
  await user.click(overseas)
  expect(screen.getByText('codex-auto-review')).toBeVisible()
  expect(screen.queryByText('custom-service')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /^Other Models/ }))
  expect(screen.queryByText('codex-auto-review')).not.toBeInTheDocument()
  expect(screen.getByText('custom-service')).toBeVisible()
})

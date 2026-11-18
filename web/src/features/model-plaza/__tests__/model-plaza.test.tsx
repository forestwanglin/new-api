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
import i18next from 'i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { PricingData } from '@/features/pricing/types'
import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import viLocale from '@/i18n/locales/vi.json'
import zh from '@/i18n/locales/zh.json'
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
  const byteDance = await within(sidebar).findByRole('button', {
    name: /字节跳动/,
  })
  expect(within(byteDance).getByText('1')).toBeVisible()
  await user.click(byteDance)
  expect(byteDance).toHaveAttribute('aria-pressed', 'true')
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

it('keeps domestic vendors selectable beneath the domestic heading', async () => {
  const user = userEvent.setup()
  renderPlaza()
  const sidebar = screen.getByRole('complementary', { name: 'Vendors' })
  expect(
    await within(sidebar).findByRole('heading', { name: 'Domestic Models' })
  ).toBeVisible()
  await user.click(within(sidebar).getByRole('button', { name: /^DeepSeek/ }))
  expect(screen.getByText('deepseek-chat')).toBeVisible()
  expect(screen.queryByText('sd2.0-720P')).not.toBeInTheDocument()
  await user.click(
    within(sidebar).getByRole('button', { name: /^Overseas Models/ })
  )
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
    name: /^zHiPu/,
  })
  expect(within(domestic).getByText('1')).toBeVisible()
  await user.click(domestic)
  expect(screen.getByText('alias-domestic')).toBeVisible()
  expect(screen.queryByText('chinese-domestic')).not.toBeInTheDocument()
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
  const domestic = await within(sidebar).findByRole('heading', {
    name: 'Domestic Models',
  })
  await user.type(
    screen.getByRole('textbox', { name: 'Search models' }),
    'video'
  )
  expect(domestic).toHaveTextContent(/^Domestic Models$/)
  expect(
    within(
      within(sidebar).getByRole('button', { name: /^字节跳动/ })
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

it('allows keyboard selection of a vendor and keeps it selected when search has no matches', async () => {
  const user = userEvent.setup()
  renderPlaza()
  const domestic = await screen.findByRole('button', {
    name: /^DeepSeek/,
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
  expect(promotion).toHaveTextContent('93% OFF')
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: /^DeepSeek/ }))
  expect(screen.queryByText('gpt-api-model')).not.toBeInTheDocument()
  expect(promotion).toHaveTextContent('93% OFF')
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
  ).toHaveTextContent('90% OFF')
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

it.each([0, 11, 99])(
  'groups codex-auto-review with OpenAI when its API vendor is %s',
  async (vendor_id) => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        ...pricing,
        data: [
          { ...pricing.data[0], model_name: 'codex-auto-review', vendor_id },
          pricing.data[1],
          {
            ...pricing.data[0],
            model_name: 'codex-auto-review-custom',
            vendor_id: 99,
          },
        ],
        vendors: [...pricing.vendors, { id: 99, name: 'Private Service' }],
      },
    })
    renderPlaza()
    const vendor = await screen.findByRole('button', { name: /^OpenAI/ })
    expect(within(vendor).getByText('2')).toBeVisible()
    await userEvent.setup().click(vendor)
    expect(screen.getByText('codex-auto-review')).toBeVisible()
    expect(screen.getByText('gpt-api-model')).toBeVisible()
    expect(screen.queryByText('custom-review')).not.toBeInTheDocument()
  }
)

it('names the codex-auto-review vendor OpenAI when the response has no OpenAI vendor', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...pricing,
      data: [
        { ...pricing.data[0], model_name: 'codex-auto-review', vendor_id: 0 },
      ],
      vendors: [],
    },
  })
  renderPlaza()
  const vendor = await screen.findByRole('button', { name: /^OpenAI/ })
  await userEvent.setup().click(vendor)
  expect(screen.getByText('codex-auto-review')).toBeVisible()
})

it('keeps dots on selectable model and vendor children', async () => {
  renderPlaza()
  await screen.findByRole('row', { name: /deepseek-chat/ })
  for (const name of [/^All Models/, /^DeepSeek/]) {
    expect(
      screen.getByRole('button', { name }).querySelector('.mp-dot')
    ).not.toBeNull()
  }
  expect(
    screen
      .getByRole('button', { name: /^Overseas Models/ })
      .querySelector('.mp-dot')
  ).toBeNull()
})

it.each(['en', 'fr', 'ru', 'ja', 'vi'])(
  'shows computed percent OFF and no duplicate headline saving in %s',
  async (language) => {
    const resources = { en, fr, ru, ja, vi: viLocale }
    i18next.addResourceBundle(
      language,
      'translation',
      resources[language as keyof typeof resources].translation
    )
    await i18next.changeLanguage(language)
    vi.mocked(api.get).mockResolvedValue({
      data: { ...pricing, group_ratio: { default: 0.5 } },
    })
    renderPlaza()
    const promotion = await screen.findByRole('status', {
      name: i18next.t('Model discount'),
    })
    expect(promotion).toHaveTextContent('93% OFF')
    expect(promotion).not.toHaveTextContent(
      i18next.t('Save up to {{percent}}%', { percent: 93 })
    )
    const row = within(screen.getByRole('row', { name: /deepseek-chat/ }))
    expect(row.getByText('50% OFF')).toBeVisible()
    cleanup()
    i18next.removeResourceBundle(language, 'translation')
    i18next.addResourceBundle('en', 'translation', {})
    await i18next.changeLanguage('en')
  }
)

it.each(['zhCN', 'zhTW'])(
  'keeps tenths and the headline saving for %s',
  async (language) => {
    i18next.addResourceBundle(language, 'translation', {
      '{{discount}} tenths of reference price': '{{discount}} 折',
    })
    await i18next.changeLanguage(language)
    vi.mocked(api.get).mockResolvedValue({
      data: { ...pricing, group_ratio: { default: 0.5 } },
    })
    renderPlaza()
    const promotion = await screen.findByRole('status', {
      name: 'Model discount',
    })
    expect(promotion).toHaveTextContent('0.7 折')
    expect(promotion).toHaveTextContent('Save up to 93%')
    expect(
      within(screen.getByRole('row', { name: /deepseek-chat/ })).getByText(
        '5 折'
      )
    ).toBeVisible()
    cleanup()
    await i18next.changeLanguage('en')
    i18next.removeResourceBundle(language, 'translation')
  }
)

it.each([true, false])(
  'groups Seedance prefixes under ByteDance with existing vendor metadata: %s',
  async (hasVendor) => {
    const names = [
      'sd2.0-480P',
      'seedance-2.5',
      'doubao-seedance-2-0-fast',
      'SD2.0-1080P',
    ]
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        ...pricing,
        data: [
          ...names.map((model_name) => ({
            ...pricing.data[0],
            model_name,
            vendor_id: 22,
          })),
          { ...pricing.data[0], model_name: 'custom-unrelated', vendor_id: 22 },
        ],
        vendors: hasVendor
          ? [...pricing.vendors, { id: 33, name: '字节跳动' }]
          : pricing.vendors,
      },
    })
    renderPlaza()
    const vendor = await screen.findByRole('button', { name: /^字节跳动/ })
    await userEvent.click(vendor)
    for (const name of names) {
      expect(screen.getByText(name)).toBeVisible()
    }
    expect(screen.queryByText('custom-unrelated')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^OpenAI/ }))
    expect(screen.getByText('custom-unrelated')).toBeVisible()
    for (const name of names) {
      expect(screen.queryByText(name)).not.toBeInTheDocument()
    }
  }
)

it('renders All Models and Domestic Models as uncounted headings and keeps the All Models child selectable', async () => {
  renderPlaza()
  const sidebar = screen.getByRole('complementary', { name: 'Vendors' })
  const allHeading = within(sidebar).getByRole('heading', {
    name: 'All Models',
  })
  const domesticHeading = await within(sidebar).findByRole('heading', {
    name: 'Domestic Models',
  })
  expect(allHeading).toHaveTextContent(/^All Models$/)
  expect(domesticHeading).toHaveTextContent(/^Domestic Models$/)
  expect(
    within(sidebar).queryByRole('button', { name: /^Domestic Models/ })
  ).not.toBeInTheDocument()
  const user = userEvent.setup()
  await user.click(within(sidebar).getByRole('button', { name: /^DeepSeek/ }))
  const all = within(sidebar).getByRole('button', { name: /^All Models/ })
  await user.click(all)
  expect(all).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('deepseek-chat')).toBeVisible()
  expect(screen.getByText('gpt-api-model')).toBeVisible()
})

it('splits all models into text then video lists and hides empty lists after vendor selection or search', async () => {
  renderPlaza()
  const text = await screen.findByRole('table', {
    name: 'All Models · Text Models',
  })
  const video = screen.getByRole('table', { name: 'All Models · Video Models' })
  expect(screen.getAllByRole('table')).toEqual([text, video])
  expect(within(text).getByText('deepseek-chat')).toBeVisible()
  expect(within(text).queryByText('sd2.0-720P')).not.toBeInTheDocument()
  expect(within(video).getByText('sd2.0-720P')).toBeVisible()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /^字节跳动/ }))
  expect(
    screen.getByRole('table', { name: '字节跳动 · Video Models' })
  ).toBeVisible()
  expect(
    screen.queryByRole('heading', { name: '字节跳动 · Text Models' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /^DeepSeek/ }))
  expect(
    screen.getByRole('table', { name: 'DeepSeek · Text Models' })
  ).toBeVisible()
  expect(
    screen.queryByRole('heading', { name: 'DeepSeek · Video Models' })
  ).not.toBeInTheDocument()
  await user.type(
    screen.getByRole('textbox', { name: 'Search models' }),
    'no-match'
  )
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(screen.getByText('No models found')).toBeVisible()
})

it('translates text and video section titles in Chinese', async () => {
  i18next.addResourceBundle('zh', 'translation', zh.translation, true, true)
  await i18next.changeLanguage('zh')
  renderPlaza()
  expect(
    await screen.findByRole('table', { name: /· 文本模型$/ })
  ).toBeVisible()
  expect(screen.getByRole('table', { name: /· 视频模型$/ })).toBeVisible()
})

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
import i18next from 'i18next'
import { afterEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import viLocale from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { PointsWallet } from '..'

it('resolves wallet translations through the real i18next resource namespace', async () => {
  const i18n = i18next.createInstance()
  const resources = { en, zh, 'zh-TW': zhTW, fr, ru, ja, vi: viLocale }
  await i18n.init({ lng: 'zh', fallbackLng: false, resources })
  const keys = [
    'Invitation reward details',
    'Administrator adjustment',
    'Model calls',
    'Current available and frozen balances come from your points accounts.',
    'Pending invitation rewards are excluded from available points until release.',
    'Processing and frozen invitation rewards become available only after release.',
    'Invitation rewards',
    'Available general points',
    'General points pending release',
    'Other available points',
    'Other points pending release',
  ] as const
  for (const [language, resource] of Object.entries(resources)) {
    const t = i18n.getFixedT(language)
    for (const key of keys) {
      expect(i18n.exists(key, { lng: language })).toBe(true)
      expect(t(key)).toBe(resource.translation[key])
    }
  }
  expect(i18n.t('Invitation reward details')).toBe('邀请奖励明细')
})

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
it('shows exact general available points and excludes frozen and other balances', async () => {
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
              pending_gpt_points: '0',
              pending_invitation_rewards: [],
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
  await screen.findByRole('region', { name: 'Wallet statistics' })
  const stats = screen.getByRole('region', { name: 'Wallet statistics' })
  expect(within(stats).getByText('9,007,199,254,740,993')).toBeVisible()
  expect(within(stats).queryByText('Not available yet')).not.toBeInTheDocument()
  expect(within(stats).getAllByText('0')).toHaveLength(2)
  expect(
    screen.queryByRole('columnheader', { name: 'Remaining points by source' })
  ).not.toBeInTheDocument()
  expect(screen.getByText('No rewards yet')).toBeVisible()
  expect(
    vi
      .mocked(api.get)
      .mock.calls.some(([url]) => url === '/api/invitation/self/summary')
  ).toBe(false)
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
              pending_gpt_points: '0',
              pending_invitation_rewards: [],
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
  expect(screen.getByText('No subscription rules')).toBeVisible()
})
it('shows the same managed rules as the public subscription page without a disclosure', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/points/wallet/self'
          ? {
              balances: [],
              pending_gpt_points: '0',
              pending_invitation_rewards: [],
              source_summaries: [],
            }
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
  expect(await screen.findByText('Configured title')).toBeVisible()
  expect(screen.getByText('Configured policy')).toBeVisible()
  expect(screen.getByText('Configured policy').closest('details')).toBeNull()
  expect(api.get).toHaveBeenCalledWith('/api/custom_subscription/rules')
  expect(api.get).not.toHaveBeenCalledWith('/api/points/wallet/rules')
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
              pending_gpt_points: '0',
              pending_invitation_rewards: [
                {
                  point_type_id: '2',
                  code: 'GPT',
                  name: 'Private reward',
                  processing_points: '67',
                  frozen_points: '8',
                  pending_points: '75',
                },
              ],
              source_summaries: [],
            }
          : { items: [] },
    },
  }))
  await renderWallet()
  expect((await screen.findAllByText('12,345')).length).toBeGreaterThan(0)
  expect(screen.getAllByText('Private reward')).toHaveLength(3)
  vi.mocked(api.get).mockImplementation(() => new Promise(() => {}))
  await act(async () =>
    useAuthStore.getState().auth.setUser({ id: 2, username: 'other', role: 1 })
  )
  expect(screen.queryByText('12,345')).not.toBeInTheDocument()
  expect(screen.queryByText('Private reward')).not.toBeInTheDocument()
})

it('shows zero general balances and empty other cards with only a general account', async () => {
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
              pending_gpt_points: '0',
              pending_invitation_rewards: [],
              source_summaries: [],
            }
          : { items: [] },
    },
  }))
  await renderWallet()
  const stats = await screen.findByRole('region', { name: 'Wallet statistics' })
  expect(
    within(stats)
      .getAllByRole('heading')
      .map((heading) => heading.textContent)
  ).toEqual([
    'Available general points',
    'General points pending release',
    'Other available points',
    'Other points pending release',
  ])
  expect(within(stats).getAllByText('0')).toHaveLength(4)
  expect(within(stats).getAllByText('No other points accounts')).toHaveLength(2)
})

it('lists every non-general available balance separately from general points', async () => {
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
                  frozen_points: '20',
                },
                {
                  point_type_id: '2',
                  code: 'GPT',
                  name: 'GPT balance',
                  available_points: '10',
                  frozen_points: '7',
                },
                {
                  point_type_id: '3',
                  code: 'CUSTOM',
                  name: 'Custom balance',
                  available_points: '25',
                  frozen_points: '9',
                },
              ],
              pending_gpt_points: '0',
              pending_invitation_rewards: [],
              source_summaries: [],
            }
          : { items: [] },
    },
  }))
  await renderWallet()
  const stats = await screen.findByRole('region', { name: 'Wallet statistics' })
  expect(within(stats).getByText('9,007,199,254,740,993')).toBeVisible()
  expect(
    within(stats).queryByText('9,007,199,254,741,028')
  ).not.toBeInTheDocument()
  const other = within(stats)
    .getByRole('heading', { name: 'Other available points' })
    .closest('div')
  if (!other) throw new Error('Other points card is missing')
  expect(within(other).getByText('GPT balance')).toBeVisible()
  expect(within(other).getByText('10')).toBeVisible()
  expect(within(other).getByText('Custom balance')).toBeVisible()
  expect(within(other).getByText('25')).toBeVisible()
  expect(within(other).queryByText('General')).not.toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'Buy points' }).parentElement
  ).toHaveClass('mb-6')
  expect(screen.getByRole('link', { name: 'Buy points' })).toHaveAttribute(
    'href',
    '/subscription'
  )
})

it('separates general and other pending rewards using exact amounts and retains reward-only types', async () => {
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
                  available_points: '50',
                  frozen_points: '12',
                },
                {
                  point_type_id: '2',
                  code: 'GPT',
                  name: 'GPT',
                  available_points: '10',
                  frozen_points: '0',
                },
              ],
              pending_gpt_points: '7',
              pending_invitation_rewards: [
                {
                  point_type_id: '1',
                  code: 'GENERAL',
                  name: 'General',
                  processing_points: '9007199254740993',
                  frozen_points: '2',
                  pending_points: '9007199254740995',
                },
                {
                  point_type_id: '2',
                  code: 'GPT',
                  name: 'GPT',
                  processing_points: '3',
                  frozen_points: '4',
                  pending_points: '7',
                },
                {
                  point_type_id: '9',
                  code: 'CUSTOM',
                  name: 'Custom reward',
                  processing_points: '0',
                  frozen_points: '8',
                  pending_points: '8',
                },
              ],
              source_summaries: [
                'CUSTOM_SUBSCRIPTION',
                'INVITATION_REWARD',
                'ADMIN_ADJUST',
                'MODEL_CALL',
              ].map((biz_type, i) => ({
                point_type_id: String(i + 1),
                point_type_code: 'GENERAL',
                point_type_name: 'General',
                biz_type,
                increased_points: '10',
                decreased_points: '1',
                net_points: '9',
              })),
            }
          : { items: [] },
    },
  }))
  await renderWallet()
  const stats = await screen.findByRole('region', { name: 'Wallet statistics' })
  expect(within(stats).getByText('50')).toBeVisible()
  expect(within(stats).queryByText('60')).not.toBeInTheDocument()
  const generalPending = within(stats).getByRole('heading', {
    name: 'General points pending release',
  }).parentElement
  if (!generalPending) throw new Error('General pending card is missing')
  expect(
    within(generalPending).getByText('9,007,199,254,740,995')
  ).toBeVisible()
  const otherPending = within(stats).getByRole('heading', {
    name: 'Other points pending release',
  }).parentElement
  if (!otherPending) throw new Error('Other pending card is missing')
  expect(within(otherPending).getByText('GPT')).toBeVisible()
  expect(within(otherPending).getByText('7')).toBeVisible()
  expect(within(otherPending).getByText('Custom reward')).toBeVisible()
  expect(within(otherPending).getByText('8')).toBeVisible()
  expect(within(otherPending).queryByText('General')).not.toBeInTheDocument()
  expect(within(stats).getByText('9,007,199,254,740,995')).toBeVisible()
  const rewards = screen.getByRole('region', {
    name: 'Invitation reward details',
  })
  expect(within(rewards).getByText('Custom reward')).toBeVisible()
  expect(
    within(rewards).getByText('Processing: 9,007,199,254,740,993')
  ).toBeVisible()
  expect(within(rewards).getByText('Frozen: 4')).toBeVisible()
  for (const source of [
    'Subscription',
    'Invitation rewards',
    'Administrator adjustment',
    'Model calls',
  ]) {
    expect(screen.getByText(source)).toBeVisible()
  }
})

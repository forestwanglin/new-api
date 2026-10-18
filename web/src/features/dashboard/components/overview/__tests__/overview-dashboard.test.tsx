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
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { OverviewDashboard } from '../overview-dashboard'

let client: QueryClient

beforeEach(() => {
  window.localStorage.clear()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'dashboard-user',
    role: 1,
    quota: 1000000,
    used_quota: 1000,
    request_count: 1,
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    switch (url) {
      case '/api/token/?p=1&size=10':
        return {
          data: {
            success: true,
            data: {
              items: [
                { id: 1, name: 'App key', key: 'masked', group: 'default' },
              ],
            },
          },
        }
      case '/api/status':
        return {
          data: {
            data: {
              api_info_enabled: false,
              announcements_enabled: false,
              faq_enabled: false,
              uptime_kuma_enabled: false,
            },
          },
        }
      case '/api/user/models':
        return { data: { success: true, data: ['gpt-4o-mini'] } }
      case '/api/user/self/groups':
        return {
          data: {
            success: true,
            data: { default: { desc: 'Default', ratio: 1 } },
          },
        }
      case '/api/pricing':
        return {
          data: {
            success: true,
            data: [
              {
                id: 1,
                model_name: 'gpt-4o-mini',
                quota_type: 0,
                model_ratio: 1,
                completion_ratio: 2,
                enable_groups: ['default'],
              },
            ],
            vendors: [],
            group_ratio: { default: 1 },
            usable_group: {},
            supported_endpoint: {},
            auto_groups: [],
          },
        }
      case '/api/user/self':
        return {
          data: {
            success: true,
            data: {
              id: 1,
              username: 'dashboard-user',
              quota: 1000000,
              used_quota: 1000,
              request_count: 1,
              aff_count: 0,
              aff_quota: 0,
              aff_history_quota: 0,
            },
          },
        }
      case '/api/user/aff':
        return { data: { success: true, data: 'zyycode' } }
      case '/api/user/topup/info':
        return {
          data: { success: true, data: { payment_compliance_confirmed: true } },
        }
      case '/api/data/self':
        return { data: { success: true, data: [] } }
      default:
        throw new Error(`Unexpected dashboard request: ${String(url)}`)
    }
  })
})

afterEach(() => {
  client.clear()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  window.localStorage.clear()
})

async function renderOverview() {
  const router = createRouter({
    routeTree: createRootRoute({ component: OverviewDashboard }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('overview dashboard layout', () => {
  test('replaces the setup guide with the access guide card and keeps recommended actions', async () => {
    await renderOverview()

    await screen.findByText('Build your first app')
    expect(screen.getByText('Recommended actions')).toBeVisible()
    expect(screen.getByText('Keep the platform ready')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Setup guide' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Setup progress:/)).not.toBeInTheDocument()
  })

  test('orders the referral panel, access guide card and usage summary', async () => {
    await renderOverview()

    const referral = await screen.findByRole('heading', {
      name: 'Referral Program',
    })
    const guide = await screen.findByText('Build your first app')
    const summary = await screen.findByRole('heading', {
      name: 'Usage at a glance',
    })

    expect(
      referral.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      guide.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})

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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster } from 'sonner'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { ApiKey } from '@/features/keys/types'
import { api } from '@/lib/api'

import { AccessGuideCard } from '../index'

function makeKey(id: number, overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id,
    name: `key-${id}`,
    key: `masked-${id}`,
    status: 1,
    remain_quota: 0,
    used_quota: 0,
    unlimited_quota: true,
    expired_time: -1,
    created_time: 0,
    accessed_time: 0,
    group: 'default',
    auto_groups: null,
    cross_group_retry: false,
    model_limits_enabled: false,
    model_limits: '',
    allow_ips: '',
    allow_user_quota_query: false,
    ...overrides,
  }
}

function pricingModel(modelName: string, enableGroups: string[]) {
  return {
    id: modelName.length,
    model_name: modelName,
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 2,
    enable_groups: enableGroups,
  }
}

let client: QueryClient
let tokenList: ApiKey[]

beforeEach(() => {
  window.localStorage.clear()
  tokenList = []
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    switch (url) {
      case '/api/status':
        return {
          data: { data: { price: 1, usd_exchange_rate: 1 } },
        }
      case '/api/token/?p=1&size=10':
        return { data: { success: true, data: { items: tokenList } } }
      case '/api/user/models':
        return {
          data: { success: true, data: ['gpt-4o-mini', 'deepseek-chat'] },
        }
      case '/api/user/self/groups':
        return {
          data: {
            success: true,
            data: {
              default: { desc: 'Default group', ratio: 1 },
              vip: { desc: 'VIP group', ratio: 0.5 },
            },
          },
        }
      case '/api/pricing':
        return {
          data: {
            success: true,
            data: [
              pricingModel('gpt-4o-mini', ['default', 'vip']),
              pricingModel('deepseek-chat', ['default']),
            ],
            vendors: [],
            group_ratio: { default: 1, vip: 0.5 },
            usable_group: {},
            supported_endpoint: {},
            auto_groups: [],
          },
        }
      default:
        throw new Error(`Unexpected GET ${String(url)}`)
    }
  })

  vi.spyOn(api, 'post').mockImplementation(async (url, body) => {
    if (url === '/api/token/') {
      const payload = body as { name?: string; group?: string }
      tokenList = [
        makeKey(99, {
          name: payload?.name ?? 'my-key-1',
          group: payload?.group ?? '',
        }),
      ]
      return { data: { success: true, data: {} } }
    }
    if (typeof url === 'string' && url.endsWith('/key')) {
      return { data: { success: true, data: { key: 'realkey123456' } } }
    }
    throw new Error(`Unexpected POST ${String(url)}`)
  })
})

afterEach(() => {
  client.clear()
})

async function renderCard() {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <AccessGuideCard /> }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  )
}

function getCommandItem(label: string): HTMLElement {
  const item = [
    ...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]'),
  ].find((candidate) => candidate.textContent?.includes(label))
  if (!item) {
    throw new Error(`Expected command item containing "${label}"`)
  }
  return item
}

describe('AccessGuideCard', () => {
  test('shows the empty state and hides models before a key exists', async () => {
    await renderCard()

    expect(await screen.findByText('No API key yet')).toBeVisible()
    expect(
      screen.getByText('Create a key first to see available models.')
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create now' })).toBeVisible()
  })

  test('blocks creation until a group is selected', async () => {
    const user = userEvent.setup()
    await renderCard()

    await user.click(await screen.findByRole('button', { name: 'Create now' }))
    expect(screen.getByLabelText('Name')).toBeVisible()
    expect(screen.queryByText('Quota')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create key' }))

    expect(await screen.findByText('Pick a group first')).toBeVisible()
    expect(api.post).not.toHaveBeenCalled()
  })

  test('creates a key with the selected group and follows it', async () => {
    const user = userEvent.setup()
    await renderCard()

    await user.click(await screen.findByRole('button', { name: 'Create now' }))
    await user.click(screen.getByRole('combobox'))
    await user.click(getCommandItem('default'))
    await user.click(screen.getByRole('button', { name: 'Create key' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/api/token/',
        expect.objectContaining({
          name: 'my-key-1',
          group: 'default',
          unlimited_quota: true,
          expired_time: -1,
        })
      )
    )
    expect(await screen.findByText('my-key-1')).toBeVisible()
  })

  test('always follows the first key and its group models', async () => {
    tokenList = [
      makeKey(5, { name: 'Newest key', group: 'vip' }),
      makeKey(4, { name: 'Older key', group: 'default' }),
    ]
    await renderCard()

    expect(await screen.findByText('Newest key')).toBeVisible()
    expect(screen.queryByText('Older key')).not.toBeInTheDocument()
    expect(await screen.findByText('gpt-4o-mini')).toBeVisible()
    expect(screen.queryByText('deepseek-chat')).not.toBeInTheDocument()
    // No key switcher: the newest key is always the one shown.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  test('switches the code sample between curl and python', async () => {
    const user = userEvent.setup()
    tokenList = [makeKey(5, { name: 'Newest key', group: 'vip' })]
    await renderCard()

    await screen.findByText('Newest key')
    await waitFor(() =>
      expect(document.querySelector('.cm-content')?.textContent).toContain(
        'curl'
      )
    )

    await user.click(screen.getByRole('tab', { name: 'Python (OpenAI SDK)' }))
    await waitFor(() =>
      expect(document.querySelector('.cm-content')?.textContent).toContain(
        'from openai import OpenAI'
      )
    )
  })

  test('copies the full key through the token key endpoint', async () => {
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue()
    tokenList = [makeKey(5, { name: 'Newest key', group: 'vip' })]
    await renderCard()

    await user.click(
      await screen.findByRole('button', { name: 'Copy full key' })
    )

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/token/5/key')
    )
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('sk-realkey123456')
    )
  })

  test('copies a runnable command that contains the real key and model', async () => {
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue()
    tokenList = [makeKey(5, { name: 'Newest key', group: 'vip' })]
    await renderCard()

    await user.click(await screen.findByRole('button', { name: 'Copy' }))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const copied = writeText.mock.calls.at(-1)?.[0] as string
    expect(copied).toContain('curl')
    expect(copied).toContain('sk-realkey123456')
    expect(copied).toContain('gpt-4o-mini')
  })

  test('reports a failed full-key lookup without writing to the clipboard', async () => {
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue()
    vi.mocked(api.post).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.endsWith('/key')) {
        return { data: { success: false, message: 'denied' } }
      }
      throw new Error(`Unexpected POST ${String(url)}`)
    })
    tokenList = [makeKey(5, { name: 'Newest key', group: 'vip' })]
    await renderCard()

    await user.click(
      await screen.findByRole('button', { name: 'Copy full key' })
    )

    await waitFor(() => expect(screen.getByText('denied')).toBeVisible())
    expect(writeText).not.toHaveBeenCalled()
  })
})

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
import { render, screen, waitFor, within } from '@testing-library/react'
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
          name: payload?.name ?? 'Create API Key',
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

async function renderCard(onHide: () => void = () => undefined) {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <AccessGuideCard onHide={onHide} />,
    }),
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

  test('replaces the code samples with fixed guidance before a key exists', async () => {
    const user = userEvent.setup()
    await renderCard()

    // Wait for the key query to settle so the empty state (and its button) is up.
    await screen.findByText('No API key yet')
    expect(
      screen.getByText(
        '# Create and select an API key to generate runnable code samples here.'
      )
    ).toBeVisible()
    expect(
      screen.getByText('1. Click the “Create now” button above.')
    ).toBeVisible()
    expect(
      screen.getByText(
        '2. Pick a group (for example the DeepSeek or GPT series).'
      )
    ).toBeVisible()
    expect(
      screen.getByText(
        '3. Copy base_url / api_key / model here into your client.'
      )
    ).toBeVisible()
    expect(document.querySelector('.shiki')).toBeNull()

    // Once a key exists the real, runnable sample takes over.
    await user.click(screen.getByRole('button', { name: 'Create now' }))
    await user.click(screen.getByRole('combobox'))
    await user.click(getCommandItem('default'))
    await user.click(screen.getByRole('button', { name: 'Create key' }))

    await waitFor(() => {
      expect(
        screen.queryByText(
          '# Create and select an API key to generate runnable code samples here.'
        )
      ).not.toBeInTheDocument()
      expect(document.querySelector('.shiki')).not.toBeNull()
    })
  })

  test('blocks creation until a group is selected', async () => {
    const user = userEvent.setup()
    await renderCard()

    await user.click(await screen.findByRole('button', { name: 'Create now' }))
    expect(screen.getByLabelText('Name')).toBeVisible()
    // The name field starts empty; no generated default like "my-key-1".
    expect(screen.getByLabelText('Name')).toHaveValue('')
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
          name: 'Create API Key',
          group: 'default',
          unlimited_quota: true,
          expired_time: -1,
        })
      )
    )
    expect(
      await screen.findByRole('combobox', { name: 'API Key' })
    ).toHaveValue('99')
    expect(
      screen.getByRole('option', { name: /Create API Key/ })
    ).toBeInTheDocument()
  })

  test('shows the first key by default and only its group models', async () => {
    tokenList = [
      makeKey(5, { name: 'Newest key', group: 'vip' }),
      makeKey(4, { name: 'Older key', group: 'default' }),
    ]
    await renderCard()

    // Both owned keys are offered through the switcher; the newest is selected.
    const selector = await screen.findByRole('combobox', { name: 'API Key' })
    expect(selector).toHaveValue('5')
    expect(
      within(selector).getByRole('option', { name: /Older key/ })
    ).toBeInTheDocument()
    expect(await screen.findByText('gpt-4o-mini')).toBeVisible()
    expect(screen.queryByText('deepseek-chat')).not.toBeInTheDocument()
  })

  test('switches models and code samples when another key is selected', async () => {
    const user = userEvent.setup()
    tokenList = [
      makeKey(5, { name: 'Newest key', group: 'vip' }),
      makeKey(4, { name: 'Older key', group: 'default' }),
    ]
    await renderCard()

    const selector = await screen.findByRole('combobox', { name: 'API Key' })
    expect(screen.queryByText('deepseek-chat')).not.toBeInTheDocument()

    await user.selectOptions(selector, '4')

    expect(await screen.findByText('deepseek-chat')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /deepseek-chat/ }))
    await waitFor(() =>
      expect(
        document.querySelector('.cm-content, .shiki')?.textContent
      ).toContain('deepseek-chat')
    )
  })

  test('highlights curl and python samples instead of rendering plain text', async () => {
    const user = userEvent.setup()
    tokenList = [makeKey(5, { name: 'Newest key', group: 'vip' })]
    await renderCard()

    await screen.findByRole('combobox', { name: 'API Key' })
    await waitFor(() => {
      const block = document.querySelector('.shiki')
      expect(block?.textContent).toContain('curl')
      // Token-level highlighting, not a single monochrome text node.
      expect(
        block?.querySelector('span[style*="--shiki-light"]')
      ).not.toBeNull()
    })

    await user.click(screen.getByRole('tab', { name: 'Python (OpenAI SDK)' }))
    await waitFor(() =>
      expect(document.querySelector('.shiki')?.textContent).toContain(
        'from openai import OpenAI'
      )
    )
  })

  test('invokes the hide callback from the card header', async () => {
    const user = userEvent.setup()
    const onHide = vi.fn()
    tokenList = [makeKey(5, { name: 'Newest key', group: 'vip' })]
    await renderCard(onHide)

    await user.click(
      await screen.findByRole('button', { name: 'Hide setup guide' })
    )
    expect(onHide).toHaveBeenCalledTimes(1)
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

  test('copies the full key from the client configuration row', async () => {
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue()
    tokenList = [makeKey(5, { name: 'Newest key', group: 'vip' })]
    await renderCard()

    await user.click(
      await screen.findByRole('tab', { name: 'Client configuration' })
    )
    const apiKeyRow = screen.getAllByText('API Key').at(-1)?.parentElement
    expect(apiKeyRow).not.toBeNull()
    await user.click(within(apiKeyRow as HTMLElement).getByRole('button'))

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

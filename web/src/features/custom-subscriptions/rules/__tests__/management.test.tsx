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
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SubscriptionRulesManagement } from '..'
import type { SubscriptionRule } from '../types'

const rule: SubscriptionRule = {
  id: '9007199254740993',
  version: '7',
  rule_key: 'renewal',
  title: 'Renewal reward',
  plan_id: null,
  plan: null,
  content: {
    blocks: [
      {
        type: 'paragraph',
        children: [
          {
            text: 'Reward phrase',
            style: { color: '#0052d9', fontWeight: 700 },
          },
        ],
      },
    ],
  },
  enabled: true,
  sort_order: 1,
  created_at: 1000,
  updated_at: 2000,
}
function renderRules(confirmed = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(['system-options'], {
    success: true,
    data: [
      { key: 'payment_setting.compliance_confirmed', value: String(confirmed) },
      { key: 'payment_setting.compliance_terms_version', value: 'v1' },
    ],
  })
  render(
    <QueryClientProvider client={client}>
      <SubscriptionRulesManagement viewer='1' onBack={() => {}} />
    </QueryClientProvider>
  )
  return client
}
beforeEach(() => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith(rule.id)
        ? rule
        : { page: 1, page_size: 20, total: 120, items: [rule] },
    },
  }))
})
it('creates a rule with styled fragments and a live preview, then refreshes the list', async () => {
  const user = userEvent.setup()
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: rule } })
  renderRules()
  await user.click(await screen.findByRole('button', { name: 'Create rule' }))
  await user.type(screen.getByRole('textbox', { name: 'Rule key' }), 'new_rule')
  await user.type(
    screen.getByRole('textbox', { name: 'Rule title' }),
    'New rule'
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Text fragment 1' }),
    'Highlighted'
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Highlight color' }),
    '#eaf3ff'
  )
  await user.click(screen.getByRole('switch', { name: 'Bold' }))
  expect(
    within(screen.getByRole('region', { name: 'Preview' })).getByText(
      'Highlighted'
    )
  ).toHaveStyle({ backgroundColor: '#eaf3ff', fontWeight: '700' })
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/custom_subscription/admin/rules',
      expect.objectContaining({
        rule_key: 'new_rule',
        plan_id: null,
        content: {
          blocks: [
            {
              type: 'paragraph',
              children: [
                {
                  text: 'Highlighted',
                  style: { backgroundColor: '#eaf3ff', fontWeight: 700 },
                },
              ],
            },
          ],
        },
      })
    )
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})
it('keeps immutable key and optimistic version while surfacing a conflict without losing edits', async () => {
  const user = userEvent.setup()
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: false, message: 'Subscription rule version conflict' },
  })
  renderRules()
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  const title = await screen.findByRole('textbox', { name: 'Rule title' })
  expect(screen.getByRole('textbox', { name: 'Rule key' })).toBeDisabled()
  await user.clear(title)
  await user.type(title, 'Unsaved rule')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Subscription rule version conflict'
  )
  expect(title).toHaveValue('Unsaved rule')
  expect(put).toHaveBeenCalledWith(
    `/api/custom_subscription/admin/rules/${rule.id}`,
    expect.objectContaining({
      version: '7',
      title: 'Unsaved rule',
      rule_key: 'renewal',
    })
  )
})
it('disables using the latest version and allows cancellation before deleting', async () => {
  const user = userEvent.setup()
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: true, data: { ...rule, enabled: false } },
  })
  const remove = vi
    .spyOn(api, 'delete')
    .mockResolvedValue({ data: { success: true } })
  renderRules()
  await user.click(await screen.findByRole('button', { name: 'Disable' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ version: '7', enabled: false })
    )
  )
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Cancel',
    })
  )
  expect(remove).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete',
    })
  )
  await waitFor(() =>
    expect(remove).toHaveBeenCalledWith(
      `/api/custom_subscription/admin/rules/${rule.id}`
    )
  )
})
it('keeps details readable but locks all writes when compliance is missing', async () => {
  const user = userEvent.setup()
  renderRules(false)
  await screen.findByText('Renewal reward')
  for (const name of ['Create rule', 'Edit', 'Disable', 'Delete']) {
    expect(screen.getByRole('button', { name })).toBeDisabled()
  }
  await user.click(screen.getByRole('button', { name: 'View details' }))
  expect(await screen.findByText('Reward phrase')).toBeVisible()
})
it('blocks an already-open form and deletion confirmation after compliance is lost', async () => {
  const user = userEvent.setup()
  const client = renderRules()
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  await screen.findByRole('textbox', { name: 'Rule title' })
  await act(async () => {
    client.setQueryData(['system-options'], { success: true, data: [] })
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  )
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  await act(async () => {
    client.setQueryData(['system-options'], {
      success: true,
      data: [
        { key: 'payment_setting.compliance_confirmed', value: 'true' },
        { key: 'payment_setting.compliance_terms_version', value: 'v1' },
      ],
    })
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()
  )
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  await act(async () => {
    client.setQueryData(['system-options'], { success: true, data: [] })
  })
  await waitFor(() =>
    expect(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete',
      })
    ).toBeDisabled()
  )
})
it('uses full administrator pagination and resets to the first page when a filter changes', async () => {
  const user = userEvent.setup()
  renderRules()
  await screen.findByText('Renewal reward')
  await user.click(screen.getByRole('button', { name: /Go to page 2/ }))
  await waitFor(() =>
    expect(api.get).toHaveBeenLastCalledWith(expect.anything(), {
      params: expect.objectContaining({ p: 2 }),
    })
  )
  await user.click(screen.getByRole('combobox'))
  await user.click(screen.getByRole('option', { name: '50' }))
  await waitFor(() =>
    expect(api.get).toHaveBeenLastCalledWith(expect.anything(), {
      params: expect.objectContaining({ p: 1, page_size: 50 }),
    })
  )
  await user.click(screen.getByRole('button', { name: 'Go to last page' }))
  await waitFor(() =>
    expect(api.get).toHaveBeenLastCalledWith(expect.anything(), {
      params: expect.objectContaining({ p: 3 }),
    })
  )
  await user.click(screen.getByRole('button', { name: 'Rule scope' }))
  await user.click(
    await screen.findByRole('option', { name: 'Plan-specific rule' })
  )
  await waitFor(() =>
    expect(api.get).toHaveBeenLastCalledWith(expect.anything(), {
      params: expect.objectContaining({ p: 1, scope: 'plan' }),
    })
  )
})
it('supports plan selection beyond the first hundred plans through pagination', async () => {
  const user = userEvent.setup()
  vi.mocked(api.get).mockImplementation(async (url, config) => {
    if (url.endsWith('/plans')) {
      const page = Number(
        (config?.params as { p?: number } | undefined)?.p ?? 1
      )
      return {
        data: {
          success: true,
          data: {
            page,
            page_size: 20,
            total: 121,
            items: [
              {
                id: String(page * 20),
                title: `Plan page ${page}`,
                code: `plan-${page}`,
              },
            ],
            point_types: [],
          },
        },
      }
    }
    return {
      data: {
        success: true,
        data: { page: 1, page_size: 20, total: 1, items: [rule] },
      },
    }
  })
  renderRules()
  await user.click(await screen.findByRole('button', { name: 'Create rule' }))
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Rule scope' }),
    'plan'
  )
  await screen.findByRole('option', { name: 'Plan page 1 (plan-1)' })
  for (let page = 2; page <= 6; page++) {
    await user.click(screen.getByRole('button', { name: 'Next plans' }))
    await screen.findByRole('option', {
      name: `Plan page ${page} (plan-${page})`,
    })
  }
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Applicable plan' }),
    '120'
  )
  expect(screen.getByRole('combobox', { name: 'Applicable plan' })).toHaveValue(
    '120'
  )
})

it('shows content validation feedback and never submits malformed highlight colors', async () => {
  const user = userEvent.setup()
  const post = vi.spyOn(api, 'post')
  renderRules()
  await user.click(await screen.findByRole('button', { name: 'Create rule' }))
  await user.type(screen.getByRole('textbox', { name: 'Rule key' }), 'invalid')
  await user.type(
    screen.getByRole('textbox', { name: 'Rule title' }),
    'Invalid color'
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Text fragment 1' }),
    'Reward'
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Highlight color' }),
    '#fff'
  )
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Check rule content and style values before saving.'
  )
  expect(post).not.toHaveBeenCalled()
})

it('keeps the draft bound to its original version when background detail refresh returns a newer rule', async () => {
  const user = userEvent.setup()
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: false, message: 'Subscription rule version conflict' },
  })
  const client = renderRules()
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  const title = await screen.findByRole('textbox', { name: 'Rule title' })
  await user.clear(title)
  await user.type(title, 'Draft based on version seven')
  await act(async () => {
    client.setQueryData(['custom-subscription-rules', '1', 'detail', rule.id], {
      ...rule,
      version: '8',
      title: 'Changed elsewhere',
    })
  })
  expect(title).toHaveValue('Draft based on version seven')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        version: '7',
        title: 'Draft based on version seven',
      })
    )
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Subscription rule version conflict'
  )
})

it('preserves an open draft when a background detail refresh fails', async () => {
  const user = userEvent.setup()
  const client = renderRules()
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  const title = await screen.findByRole('textbox', { name: 'Rule title' })
  await user.clear(title)
  await user.type(title, 'Keep my draft')
  vi.mocked(api.get).mockRejectedValue(new Error('Refresh failed'))
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ['custom-subscription-rules', '1', 'detail', rule.id],
    })
  })
  expect(title).toHaveValue('Keep my draft')
  expect(await screen.findByRole('alert')).toHaveTextContent('Refresh failed')
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
})

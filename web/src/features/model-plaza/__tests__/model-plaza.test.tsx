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
import { DEFAULT_CURRENCY_CONFIG, useSystemConfigStore } from '@/stores/system-config-store'

import { ModelPlaza } from '..'

vi.mock('@/components/layout', () => ({
  PublicLayout: (props: { children: React.ReactNode }) => <div>{props.children}</div>,
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
    { id: 1, model_name: 'deepseek-chat', description: 'General conversation', vendor_id: 11, quota_type: 0, model_ratio: 1, completion_ratio: 4, enable_groups: ['default'] },
    { id: 2, model_name: 'gpt-api-model', description: 'Code review', vendor_id: 22, quota_type: 0, model_ratio: 2, completion_ratio: 3, enable_groups: ['default'] },
    { id: 3, model_name: 'sd2.0-720P', description: 'Video generation', vendor_id: 11, quota_type: 1, model_price: 0.3, model_ratio: 0, completion_ratio: 0, enable_groups: ['default'], supported_endpoint_types: ['openai-video'] },
    { id: 4, model_name: 'tiered-api-model', description: 'Dynamic tokens', vendor_id: 22, quota_type: 0, model_ratio: 0, completion_ratio: 0, billing_mode: 'tiered_expr', billing_expr: 'tier("standard", p * 5 + c * 15)', enable_groups: ['default'] },
  ],
  vendors: [{ id: 11, name: 'DeepSeek' }, { id: 22, name: 'OpenAI' }],
  group_ratio: { default: 1 },
  usable_group: { default: { desc: 'Default', ratio: 1 } },
  supported_endpoint: {},
  auto_groups: [],
}

let client: QueryClient
beforeEach(() => {
  useAuthStore.getState().auth.reset()
  useSystemConfigStore.getState().setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType: 'USD' } })
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/status') return { data: { success: true, price: 1, usd_exchange_rate: 7 } }
    if (url === '/api/model/pricing') return { data: pricing }
    throw new Error('Unexpected endpoint: ' + url)
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  useLoginModalStore.getState().close()
  useAuthStore.getState().auth.reset()
  useSystemConfigStore.getState().setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
})

function renderPlaza() {
  return render(<QueryClientProvider client={client}><ModelPlaza /></QueryClientProvider>)
}

it('renders only API models and uses the original token, video and expression prices', async () => {
  renderPlaza()
  const token = within(await screen.findByRole('row', { name: /deepseek-chat/ }))
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
  expect(screen.queryByText('比官网省', { exact: false })).not.toBeInTheDocument()
})

it('counts every API model including video under its vendor and combines vendor and search filters', async () => {
  const user = userEvent.setup()
  renderPlaza()
  const sidebar = screen.getByRole('complementary', { name: 'Vendors' })
  const deepseek = await within(sidebar).findByRole('button', { name: 'DeepSeek 2' })
  await user.click(deepseek)
  expect(deepseek).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('sd2.0-720P')).toBeVisible()
  expect(screen.queryByText('gpt-api-model')).not.toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'Search models' }), 'video')
  expect(screen.getByText('sd2.0-720P')).toBeVisible()
  expect(screen.queryByText('deepseek-chat')).not.toBeInTheDocument()
  await user.click(within(sidebar).getByRole('button', { name: 'All Models 4' }))
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
    if (failed) return { data: { success: false, message: 'Pricing temporarily unavailable' } }
    return { data: pricing }
  })
  renderPlaza()
  expect(await screen.findByText('Pricing temporarily unavailable')).toBeVisible()
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
  vi.mocked(api.get).mockResolvedValue({ data: { ...pricing, data: [{ ...pricing.data[0], model_name: 'member-only-model' }] } })
  act(() => useAuthStore.getState().auth.setUser({ id: 7, username: 'member', role: 1, group: 'vip' }))
  expect(await screen.findByText('member-only-model')).toBeVisible()
  expect(screen.queryByText('deepseek-chat')).not.toBeInTheDocument()
  const row = within(screen.getByRole('row', { name: /member-only-model/ }))
  expect(row.getByRole('link', { name: 'Use model' })).toHaveAttribute('href', '/keys')
})

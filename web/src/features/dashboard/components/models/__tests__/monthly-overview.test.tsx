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
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { MonthlyOverview } from '../monthly-overview'

const fullSummary = {
  quota: 3000,
  points: 1649,
  total_calls: 35,
  top_model: { model_name: 'gpt-4', count: 30 },
  top_token: { token_id: 200, token_name: 'other-key', points: 500 },
}

const emptySummary = {
  quota: 0,
  points: 0,
  total_calls: 0,
  top_model: null,
  top_token: null,
}

function body(data: unknown) {
  return { data: { success: true, message: '', data } }
}

beforeEach(() => {
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  const config = useSystemConfigStore.getState().config
  useSystemConfigStore.setState({
    config: {
      ...config,
      currency: { ...config.currency, quotaDisplayType: 'TOKENS' },
    },
  })
})

afterEach(() => {
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

describe('MonthlyOverview', () => {
  test('renders four cards and uses the root endpoint for root users', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockImplementation(async (url) => {
        if (url === '/api/data/monthly-summary') return body(fullSummary)
        throw new Error(`unexpected request: ${String(url)}`)
      })

    render(<MonthlyOverview isRoot />)

    expect(await screen.findByText('This Month at a Glance')).toBeVisible()
    expect(screen.getByText("This Month's Spend")).toBeVisible()
    expect(screen.getByText("This Month's Points")).toBeVisible()
    expect(screen.getByText('Most Used Model')).toBeVisible()
    expect(screen.getByText('Most Expensive Key')).toBeVisible()

    // Values from the summary.
    expect(screen.getByText('gpt-4')).toBeVisible()
    expect(screen.getByText('other-key')).toBeVisible()
    expect(screen.getByText('1,649')).toBeVisible()

    // Root endpoint used; self endpoint not.
    expect(get).toHaveBeenCalledWith(
      '/api/data/monthly-summary',
      expect.anything()
    )
    expect(get).not.toHaveBeenCalledWith(
      '/api/data/monthly-summary/self',
      expect.anything()
    )
  })

  test('uses the self endpoint for non-root users', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockImplementation(async (url) => {
        if (url === '/api/data/monthly-summary/self') return body(fullSummary)
        throw new Error(`unexpected request: ${String(url)}`)
      })

    render(<MonthlyOverview isRoot={false} />)

    await screen.findByText('This Month at a Glance')

    expect(get).toHaveBeenCalledWith(
      '/api/data/monthly-summary/self',
      expect.anything()
    )
    expect(get).not.toHaveBeenCalledWith(
      '/api/data/monthly-summary',
      expect.anything()
    )
  })

  test('shows empty states when there is no data', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(body(emptySummary))

    render(<MonthlyOverview isRoot={false} />)

    await screen.findByText('This Month at a Glance')

    // Model and token cards both fall back to "No data".
    expect(screen.getAllByText('No data')).toHaveLength(2)
    expect(screen.getByText('No calls this month yet')).toBeVisible()
    expect(screen.getByText('No consumption this month yet')).toBeVisible()
  })

  test('labels a deleted key when the token name is empty', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(
      body({
        ...fullSummary,
        top_token: { token_id: 200, token_name: '', points: 500 },
      })
    )

    render(<MonthlyOverview isRoot={false} />)

    expect(await screen.findByText('Deleted key')).toBeVisible()
  })

  test('shows error placeholders on failure', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('boom'))

    render(<MonthlyOverview isRoot={false} />)

    await screen.findByText('This Month at a Glance')

    // All four values render the error placeholder.
    expect(screen.getAllByText('--')).toHaveLength(4)
  })
})

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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SectionPageLayout } from '@/components/layout'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { PointLedger } from '..'
import type { PointLedgerItem, PointLedgerPage } from '../types'

const row: PointLedgerItem = {
  id: '9007199254740993',
  transaction_id: '10',
  account_id: '2',
  account_version: '3',
  freeze_id: null,
  user_id: '1',
  point_type_id: '99',
  point_type_code: '',
  point_type_name: '',
  action: 'FUTURE_ACTION',
  biz_type: 'MODEL_REQUEST',
  biz_id: 'request-1',
  related_transaction_id: null,
  remark: '',
  available_delta: '-20',
  frozen_delta: '10',
  available_before: '100',
  available_after: '80',
  frozen_before: '0',
  frozen_after: '10',
  created_at: 1794470400000,
}
const page: PointLedgerPage = {
  page: 1,
  page_size: 20,
  total: 1,
  items: [row],
  point_types: [{ id: '1', code: 'GENERAL', name: 'General points' }],
}
function response(data: PointLedgerPage) {
  return { data: { success: true, data } }
}

// The usage-logs default range is today 00:00:00 ~ now + 1 hour.
const fakeNow = new Date(2026, 8, 8, 12)
const defaultRange = {
  start_timestamp: new Date(2026, 8, 8, 0).getTime(),
  end_timestamp: new Date(2026, 8, 8, 13).getTime(),
}
const defaultTriggerName = '2026-09-08 00:00:00 ~ 2026-09-08 13:00:00'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(fakeNow)
  useAuthStore.getState().auth.setUser({ id: 1, username: 'first', role: 1 })
})
afterEach(() => {
  vi.useRealTimers()
  useAuthStore.getState().auth.reset()
})

function setup() {
  const get = vi.spyOn(api, 'get').mockResolvedValue(response(page))
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Content>
          <PointLedger scope='self' />
        </SectionPageLayout.Content>
      </SectionPageLayout>
    </QueryClientProvider>
  )
  return get
}

describe('point ledger time range', () => {
  it('requests the usage-logs default range on load', async () => {
    const get = setup()
    await screen.findByText('FUTURE_ACTION')
    expect(get).toHaveBeenLastCalledWith('/api/points/ledger/self', {
      params: { p: 1, page_size: 20, ...defaultRange },
    })
  })

  it('uses the usage-logs compact range picker with presets', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByText('FUTURE_ACTION')
    await user.click(screen.getByRole('button', { name: defaultTriggerName }))
    expect(screen.getByRole('button', { name: 'Today' })).toBeVisible()
    expect(screen.getByRole('button', { name: '7 Days' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'This week' })).toBeVisible()
    expect(screen.getByRole('button', { name: '30 Days' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Current month' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeVisible()
  })

  it('applies a preset after search and returns to the default range on reset', async () => {
    const get = setup()
    const user = userEvent.setup()
    await screen.findByText('FUTURE_ACTION')
    await user.click(screen.getByRole('button', { name: defaultTriggerName }))
    await user.click(screen.getByRole('button', { name: '7 Days' }))
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith('/api/points/ledger/self', {
        params: {
          p: 1,
          page_size: 20,
          start_timestamp: new Date(2026, 8, 2).getTime(),
          end_timestamp: new Date(2026, 8, 8, 23, 59, 59, 999).getTime(),
        },
      })
    )
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith('/api/points/ledger/self', {
        params: { p: 1, page_size: 20, ...defaultRange },
      })
    )
  })
})

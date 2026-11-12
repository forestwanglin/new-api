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
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { Points } from '..'

afterEach(() => useAuthStore.getState().auth.reset())

function setup() {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 10 })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Points />
    </QueryClientProvider>
  )
}

describe('administrator point ledger', () => {
  it('opens the ledger tab without replacing existing points configuration', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: {
        success: true,
        data:
          url === '/api/points/types'
            ? []
            : { page: 1, page_size: 20, total: 0, items: [], point_types: [] },
      },
    }))
    setup()
    expect(await screen.findByText('No point types configured')).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Point Ledger' }))
    expect(await screen.findByText('No point ledger entries')).toBeVisible()
  })
})

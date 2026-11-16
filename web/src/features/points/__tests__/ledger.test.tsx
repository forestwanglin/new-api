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
import { render, screen } from '@testing-library/react'
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

describe('points management entry', () => {
  it('shows point type configuration directly without tabs or ledger requests', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: [] },
    })
    setup()
    expect(await screen.findByText('No point types configured')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Points management' })
    ).toBeVisible()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('/api/points/types')
  })
})

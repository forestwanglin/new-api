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
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { useStatus } from '../use-status'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderHook(() => useStatus(), {
    wrapper: (props: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    ),
  })
}
it('does not trust a cached unconfigured placeholder before the server confirms settings', async () => {
  localStorage.setItem(
    'status',
    JSON.stringify({ user_agreement_enabled: false })
  )
  let resolve!: (value: unknown) => void
  vi.spyOn(api, 'get').mockReturnValue(
    new Promise((done) => {
      resolve = done
    })
  )
  const { result } = mount()
  expect(result.current.ready).toBe(false)
  await act(async () =>
    resolve({ data: { success: true, data: { user_agreement_enabled: true } } })
  )
  await waitFor(() => expect(result.current.ready).toBe(true))
  expect(result.current.status?.user_agreement_enabled).toBe(true)
})
it('keeps settings unready after a failed read instead of treating the error as no agreement', async () => {
  vi.spyOn(api, 'get').mockRejectedValue(new Error('Status unavailable'))
  const { result } = mount()
  await waitFor(() => expect(result.current.error).toBeTruthy())
  expect(result.current.ready).toBe(false)
})
it('permits the empty-configuration path only after a successful status read', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        user_agreement_enabled: false,
        subscription_agreement_enabled: false,
      },
    },
  })
  const { result } = mount()
  await waitFor(() => expect(result.current.ready).toBe(true))
  expect(result.current.status?.subscription_agreement_enabled).toBe(false)
})

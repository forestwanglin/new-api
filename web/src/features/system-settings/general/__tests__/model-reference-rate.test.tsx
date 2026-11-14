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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { PricingSection } from '../pricing-section'

function Fixture() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <div ref={setContainer} />
      <SettingsPageProvider actionsContainer={container}>
        <PricingSection
          defaultValues={{
            QuotaPerUnit: 500000,
            USDExchangeRate: 6.5,
            DisplayInCurrencyEnabled: true,
            DisplayTokenStatEnabled: true,
            general_setting: {
              quota_display_type: 'USD',
              custom_currency_symbol: '¤',
              custom_currency_exchange_rate: 1,
              model_reference_exchange_rate: 7,
            },
          }}
        />
      </SettingsPageProvider>
    </>
  )
}
async function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(['status'], { model_reference_exchange_rate: 7 })
  const router = createRouter({
    routeTree: createRootRoute({ component: Fixture }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('spinbutton', {
    name: 'Model reference exchange rate (CNY per USD)',
  })
  return client
}
beforeEach(() => {
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})
it('saves an independent reference rate and invalidates public status', async () => {
  const client = await mount()
  const input = screen.getByRole('spinbutton', {
    name: 'Model reference exchange rate (CNY per USD)',
  })
  expect(input).toHaveValue(7)
  fireEvent.change(input, { target: { value: '8.25' } })
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'general_setting.model_reference_exchange_rate',
      value: '8.25',
    })
  )
  expect(api.put).toHaveBeenCalledTimes(1)
  expect(client.getQueryState(['status'])?.isInvalidated).toBe(true)
  expect(
    screen.getByRole('spinbutton', { name: 'USD Exchange Rate' })
  ).toHaveValue(6.5)
})
it('rejects zero reference rate and allows resetting the edit', async () => {
  await mount()
  const input = screen.getByRole('spinbutton', {
    name: 'Model reference exchange rate (CNY per USD)',
  })
  fireEvent.change(input, { target: { value: '0' } })
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await screen.findByText('Exchange rate must be greater than 0')
  expect(api.put).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
  expect(input).toHaveValue(7)
})

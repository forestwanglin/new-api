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
import type { ReactNode } from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJSONStorage } from 'zustand/middleware'

import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { CachedPriceCell } from '../components/cached-price-cell'
import { ModelCard } from '../components/model-card'
import { ModelPriceCell } from '../components/model-price-cell'
import { PriceDiscountBadge } from '../components/price-discount-badge'
import { usePricingColumns } from '../components/pricing-columns'
import { getDisplayDiscount } from '../lib/display-discount'
import type { PricingModel } from '../types'

function pricingModel(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: 'deepseek-v4-pro',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 3,
    enable_groups: ['DeepSeek'],
    group_ratio: { DeepSeek: 0.6 },
    ...overrides,
  }
}

const UNPARSABLE_EXPRESSION =
  'u("seconds") > 30 ? tier("long", u("seconds") * 0.3) : tier("short", u("seconds") * 0.4)'

let queryClient: QueryClient
const originalStorage = useSystemConfigStore.persist.getOptions().storage
beforeEach(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size
    },
  })
  useSystemConfigStore.persist.setOptions({
    storage: createJSONStorage(() => localStorage),
  })
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType: 'USD' },
  })
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
})
afterEach(() => {
  queryClient.clear()
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
  vi.unstubAllGlobals()
  useSystemConfigStore.persist.setOptions({ storage: originalStorage })
})

function renderCard(
  overrides: Partial<PricingModel> = {},
  selectedGroup?: string
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ModelCard
        model={pricingModel(overrides)}
        selectedGroup={selectedGroup}
        onClick={vi.fn()}
      />
    </QueryClientProvider>
  )
}

describe('model card group discount', () => {
  it('shows the discount badge and the struck-through original price', () => {
    renderCard({}, 'DeepSeek')

    expect(screen.getByText('-40%')).toBeVisible()
    expect(screen.getByText('$1.2')).toBeVisible()
    expect(screen.getByLabelText('Original price $2')).toBeVisible()
    expect(screen.getByLabelText('Original price $6')).toBeVisible()
    expect(document.querySelectorAll('del')).toHaveLength(2)
  })

  it('hides the badge and the original price when the multiplier is 1', () => {
    renderCard(
      {
        enable_groups: ['DeepSeek', 'default'],
        group_ratio: { DeepSeek: 0.6, default: 1 },
      },
      'default'
    )

    expect(screen.queryByText('-40%')).not.toBeInTheDocument()
    expect(document.querySelectorAll('del')).toHaveLength(0)
    expect(screen.getByText('$2')).toBeVisible()
  })

  it('shows a premium badge without any struck-through price', () => {
    renderCard(
      { enable_groups: ['Gemini'], group_ratio: { Gemini: 1.5 } },
      'Gemini'
    )

    expect(screen.getByText('+50%')).toBeVisible()
    expect(document.querySelectorAll('del')).toHaveLength(0)
  })

  it('names the cheapest group when no group is selected', () => {
    renderCard()

    expect(screen.getByText('Best group -40%')).toBeVisible()
    expect(screen.getByLabelText('DeepSeek -40%')).toBeVisible()
  })

  it('keeps the seeded video price card free of the generic discount display', () => {
    renderCard(
      { model_name: 'sd2.0-720P', quota_type: 1, model_price: 1 },
      'DeepSeek'
    )

    expect(screen.queryByText('-40%')).not.toBeInTheDocument()
    expect(document.querySelectorAll('del')).toHaveLength(0)
  })

  it('skips the discount display while the billing expression is unparsable', () => {
    renderCard(
      {
        billing_mode: 'tiered_expr',
        billing_expr: UNPARSABLE_EXPRESSION,
        billing_usage_schema: {
          seconds: { type: 'number', unit: 'second' },
        },
      },
      'DeepSeek'
    )

    expect(screen.getByText('Special billing expression')).toBeVisible()
    expect(screen.queryByText('-40%')).not.toBeInTheDocument()
  })
})

describe('table price cells', () => {
  it('shows the original token price under the discounted one', () => {
    render(
      <ModelPriceCell
        model={pricingModel()}
        options={{ selectedGroup: 'DeepSeek' }}
      />
    )

    expect(screen.getByText('1.2')).toBeVisible()
    expect(screen.getByLabelText('Original price 2')).toBeVisible()
    expect(screen.getByLabelText('Original price 6')).toBeVisible()
  })

  it('shows the original cached price under the discounted one', () => {
    render(
      <CachedPriceCell
        model={pricingModel({ cache_ratio: 0.25 })}
        options={{ selectedGroup: 'DeepSeek' }}
      />
    )

    expect(screen.getByText('$0.3')).toBeVisible()
    expect(screen.getByLabelText('Original price $0.5')).toBeVisible()
  })

  it('renders the discount badge inside the type column', () => {
    const { result } = renderHook(() =>
      usePricingColumns({ selectedGroup: 'DeepSeek' })
    )
    const typeColumn = result.current.find(
      (column) => 'accessorKey' in column && column.accessorKey === 'quota_type'
    )
    expect(typeColumn?.size).toBe(130)

    const renderCell = typeColumn?.cell as (context: {
      row: { original: PricingModel }
    }) => ReactNode
    render(<>{renderCell({ row: { original: pricingModel() } })}</>)

    expect(screen.getByText('-40%')).toBeVisible()
  })
})

describe('price discount badge', () => {
  it('renders nothing without a discount', () => {
    const discount = getDisplayDiscount(
      pricingModel({ enable_groups: ['default'], group_ratio: { default: 1 } }),
      'default'
    )

    const { container } = render(<PriceDiscountBadge discount={discount} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the premium multiplier addressable for assistive tech', () => {
    render(
      <PriceDiscountBadge
        discount={getDisplayDiscount(
          pricingModel({
            enable_groups: ['Gemini'],
            group_ratio: { Gemini: 1.5 },
          }),
          'Gemini'
        )}
      />
    )

    expect(screen.getByText('+50%')).toBeVisible()
    expect(screen.getByLabelText('Gemini +50%')).toBeVisible()
  })
})

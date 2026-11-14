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
import { describe, expect, it } from 'vitest'

import type { PricingModel } from '@/features/pricing/types'

import { formatModelDiscount, getModelDiscountRatio } from '../display-discount'

function model(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: 'test',
    vendor_name: 'OpenAI',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 3,
    enable_groups: ['default'],
    group_ratio: { default: 0.6 },
    ...overrides,
  }
}

describe('model reference comparisons', () => {
  it('uses the real best group multiplier with overseas reference conversion', () => {
    expect(
      getModelDiscountRatio(
        model({
          enable_groups: ['default', 'member'],
          group_ratio: { default: 0.6, member: 0.5 },
        })
      )
    ).toBeCloseTo(0.5 / 7)
    expect(getModelDiscountRatio(model({ vendor_name: 'DeepSeek' }))).toBe(0.6)
    expect(
      getModelDiscountRatio(model({ vendor_name: 'Unlisted vendor' }))
    ).toBe(0.6)
  })

  it('compares numeric expression and request prices using their display multiplier', () => {
    expect(
      getModelDiscountRatio(
        model({
          billing_mode: 'tiered_expr',
          billing_expr: 'tier("standard", p * 5 + c * 15)',
        })
      )
    ).toBeCloseTo(0.6 / 7)
    expect(
      getModelDiscountRatio(model({ quota_type: 1, model_price: 0.2 }))
    ).toBeCloseTo(0.6 / 7)
  })

  it('keeps valid free groups as zero while excluding missing or invalid references', () => {
    expect(getModelDiscountRatio(model({ group_ratio: { default: 0 } }))).toBe(
      0
    )
    expect(getModelDiscountRatio(model({ model_ratio: 0 }))).toBeNull()
    expect(getModelDiscountRatio(model({ model_ratio: Number.NaN }))).toBeNull()
    expect(
      getModelDiscountRatio(model({ group_ratio: { default: -1 } }))
    ).toBeNull()
    expect(getModelDiscountRatio(model({ completion_ratio: -1 }))).toBeNull()
    expect(getModelDiscountRatio(model({ quota_type: 1 }))).toBeNull()
  })

  it('does not claim comparable discounts for special expressions or legacy video prices', () => {
    expect(
      getModelDiscountRatio(
        model({
          billing_mode: 'tiered_expr',
          billing_expr: 'p > 10 ? 0.3 : 0.4',
        })
      )
    ).toBeNull()
    expect(
      getModelDiscountRatio(
        model({ model_name: 'sd2.0-720P', quota_type: 1, model_price: 0.3 })
      )
    ).toBeNull()
  })

  it('formats ordinary, tiny and free discounts without rounding them to a false zero', () => {
    expect(formatModelDiscount(0.6 / 7)).toBe('0.9')
    expect(formatModelDiscount(0.5)).toBe('5')
    expect(formatModelDiscount(0.001)).toBe('<0.1')
    expect(formatModelDiscount(0)).toBe('0')
  })
})

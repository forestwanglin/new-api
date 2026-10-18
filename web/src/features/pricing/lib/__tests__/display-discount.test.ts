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

import { FILTER_ALL } from '../../constants'
import type { PricingModel } from '../../types'
import {
  BASE_GROUP_KEY,
  formatDiscountPercent,
  getBasePriceOptions,
  getDisplayDiscount,
  withBaseGroupRatio,
} from '../display-discount'
import { getDisplayGroupRatio } from '../model-helpers'

function model(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: 'example-model',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 3,
    enable_groups: ['default'],
    group_ratio: { default: 1 },
    ...overrides,
  }
}

describe('getDisplayDiscount', () => {
  it('reports a discount when the selected group multiplier is below 1', () => {
    const discount = getDisplayDiscount(
      model({ enable_groups: ['DeepSeek'], group_ratio: { DeepSeek: 0.6 } }),
      'DeepSeek'
    )

    expect(discount).toEqual({
      group: 'DeepSeek',
      ratio: 0.6,
      percent: -40,
      kind: 'discount',
      isBest: false,
    })
  })

  it('reports a premium when the selected group multiplier is above 1', () => {
    const discount = getDisplayDiscount(
      model({ enable_groups: ['Gemini'], group_ratio: { Gemini: 1.5 } }),
      'Gemini'
    )

    expect(discount.kind).toBe('premium')
    expect(discount.percent).toBe(50)
    expect(discount.ratio).toBe(1.5)
  })

  it('treats multipliers within the epsilon of 1 as no discount', () => {
    for (const ratio of [0.999, 1, 1.004]) {
      const discount = getDisplayDiscount(
        model({ enable_groups: ['g'], group_ratio: { g: ratio } }),
        'g'
      )

      expect(discount.kind).toBe('none')
      expect(discount.percent).toBe(0)
      expect(discount.group).toBeUndefined()
    }
  })

  it('falls back to the cheapest enabled group when no group is selected', () => {
    const discount = getDisplayDiscount(
      model({
        enable_groups: ['premium', 'standard'],
        group_ratio: { premium: 1.5, standard: 0.8 },
      })
    )

    expect(discount.group).toBe('standard')
    expect(discount.isBest).toBe(true)
    expect(discount.percent).toBe(-20)
  })

  it('breaks equal multipliers by enable_groups order', () => {
    const discount = getDisplayDiscount(
      model({
        enable_groups: ['beta', 'alpha'],
        group_ratio: { beta: 0.5, alpha: 0.5 },
      })
    )

    expect(discount.group).toBe('beta')
  })

  it('treats the "all" filter as no selection', () => {
    const discount = getDisplayDiscount(
      model({ enable_groups: ['DeepSeek'], group_ratio: { DeepSeek: 0.6 } }),
      FILTER_ALL
    )

    expect(discount.isBest).toBe(true)
    expect(discount.group).toBe('DeepSeek')
  })

  it('ignores a selected group the model does not enable', () => {
    const discount = getDisplayDiscount(
      model({ enable_groups: ['DeepSeek'], group_ratio: { DeepSeek: 0.6 } }),
      'Kiro'
    )

    expect(discount.isBest).toBe(true)
    expect(discount.group).toBe('DeepSeek')
  })

  it('resolves the same ratio the price formatters use', () => {
    const cases: Array<{
      model: PricingModel
      selections: Array<string | undefined>
    }> = [
      {
        model: model({
          enable_groups: ['premium', 'standard'],
          group_ratio: { premium: 1.5, standard: 0.8 },
        }),
        selections: [undefined, FILTER_ALL, 'standard', 'premium', 'missing'],
      },
      {
        model: model({ enable_groups: [], group_ratio: {} }),
        selections: [undefined, FILTER_ALL, 'default'],
      },
      {
        model: model({ enable_groups: ['g'], group_ratio: {} }),
        selections: [undefined, 'g'],
      },
    ]

    for (const testCase of cases) {
      for (const selectedGroup of testCase.selections) {
        expect(
          getDisplayDiscount(testCase.model, selectedGroup).ratio
        ).toBe(getDisplayGroupRatio(testCase.model, selectedGroup))
      }
    }
  })
})

describe('formatDiscountPercent', () => {
  it('keeps the sign coming from the ratio direction', () => {
    expect(formatDiscountPercent(-40)).toBe('-40%')
    expect(formatDiscountPercent(50)).toBe('+50%')
  })
})

describe('base price helpers', () => {
  it('neutralises the group multiplier without dropping other options', () => {
    const base = getBasePriceOptions({
      tokenUnit: 'K',
      groupRatioMultiplier: 0.6,
      showRechargePrice: true,
    })

    expect(base).toMatchObject({
      tokenUnit: 'K',
      groupRatioMultiplier: 1,
      showRechargePrice: true,
    })
  })

  it('clones a model onto a single ratio-1 group', () => {
    const original = model({
      enable_groups: ['DeepSeek'],
      group_ratio: { DeepSeek: 0.6 },
    })

    const base = withBaseGroupRatio(original)

    expect(base.enable_groups).toEqual([BASE_GROUP_KEY])
    expect(base.group_ratio?.[BASE_GROUP_KEY]).toBe(1)
    expect(base.model_ratio).toBe(1)
    expect(original.enable_groups).toEqual(['DeepSeek'])
    expect(original.group_ratio).toEqual({ DeepSeek: 0.6 })
  })
})

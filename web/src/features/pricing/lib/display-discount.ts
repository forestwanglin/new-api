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
import { FILTER_ALL } from '../constants'
import type { PricingModel } from '../types'
import {
  getDynamicPricingSummary,
  isDynamicPricingModel,
  type DynamicPriceOptions,
} from './dynamic-price'
import { getConfiguredGroupRatio } from './model-helpers'
import { getSeedanceVideoSpec } from './video-price'

/**
 * Synthetic group that carries a multiplier of exactly 1, used to render the
 * undiscounted price through the very same formatters as the display price.
 */
export const BASE_GROUP_KEY = '__base'

/** Ratio deltas below this threshold are treated as "no discount". */
const RATIO_EPSILON = 0.005

export type DisplayDiscountKind = 'none' | 'discount' | 'premium'

export interface DisplayDiscount {
  /** Group whose multiplier produced `ratio`. Absent when there is no discount. */
  group?: string
  /** Group multiplier applied to the displayed price. */
  ratio: number
  /** Signed change in percent: -40 for 0.6, 50 for 1.5. */
  percent: number
  kind: DisplayDiscountKind
  /**
   * True when `ratio` comes from the cheapest available group instead of an
   * explicit group selection.
   */
  isBest: boolean
}

/**
 * Resolve the group multiplier used for display prices.
 *
 * Keeps the selection order identical to `getDisplayGroupRatio` so that the
 * discount badge always annotates the exact ratio the price was computed with;
 * `display-discount.test.ts` locks this equality down for the full matrix.
 */
function resolveDisplayGroup(
  model: PricingModel,
  selectedGroup?: string
): { group?: string; ratio: number; isBest: boolean } {
  const enableGroups = Array.isArray(model.enable_groups)
    ? model.enable_groups
    : []
  const groupRatio = model.group_ratio || {}

  if (
    selectedGroup &&
    selectedGroup !== FILTER_ALL &&
    enableGroups.includes(selectedGroup)
  ) {
    return {
      group: selectedGroup,
      ratio: getConfiguredGroupRatio(groupRatio, selectedGroup),
      isBest: false,
    }
  }

  let bestGroup: string | undefined
  let bestRatio = Number.POSITIVE_INFINITY

  for (const group of enableGroups) {
    const ratio = groupRatio[group]
    if (
      typeof ratio === 'number' &&
      Number.isFinite(ratio) &&
      ratio < bestRatio
    ) {
      bestGroup = group
      bestRatio = ratio
    }
  }

  if (bestGroup === undefined) {
    return { ratio: 1, isBest: false }
  }

  return { group: bestGroup, ratio: bestRatio, isBest: true }
}

/**
 * Discount derived from the group multiplier, for cards, table rows and the
 * model details drawer.
 */
export function getDisplayDiscount(
  model: PricingModel,
  selectedGroup?: string
): DisplayDiscount {
  const { group, ratio, isBest } = resolveDisplayGroup(model, selectedGroup)

  if (Math.abs(ratio - 1) < RATIO_EPSILON) {
    return { ratio, percent: 0, kind: 'none', isBest }
  }

  return {
    group,
    ratio,
    percent: Math.round((ratio - 1) * 100),
    kind: ratio < 1 ? 'discount' : 'premium',
    isBest,
  }
}

/** `-40` → `-40%`, `50` → `+50%`. */
export function formatDiscountPercent(percent: number): string {
  return `${percent > 0 ? '+' : ''}${percent}%`
}

/**
 * True when the model carries a billing expression that yields no numeric
 * prices, so a discount badge would have nothing to annotate.
 *
 * The unit passed below is irrelevant: `isSpecialExpression` only depends on
 * whether the expression contains parsable tiers.
 */
export function isUnpriceableExpression(model: PricingModel): boolean {
  if (!isDynamicPricingModel(model)) {
    return false
  }
  const summary = getDynamicPricingSummary(model, { tokenUnit: 'M' })
  return summary?.isSpecialExpression ?? false
}

/**
 * Discount worth rendering for a model.
 *
 * Filtered out for models that already publish their own price card (seeded
 * video specs) and for expressions that yield no numeric price, because a
 * badge would have nothing to annotate there.
 */
export function getVisibleDiscount(
  model: PricingModel,
  selectedGroup?: string
): DisplayDiscount {
  const discount = getDisplayDiscount(model, selectedGroup)
  if (discount.kind === 'none') {
    return discount
  }
  if (getSeedanceVideoSpec(model) !== undefined) {
    return { ratio: discount.ratio, percent: 0, kind: 'none', isBest: false }
  }
  if (isUnpriceableExpression(model)) {
    return { ratio: discount.ratio, percent: 0, kind: 'none', isBest: false }
  }
  return discount
}

/**
 * Clone a model so that every price formatter resolves a multiplier of 1 while
 * keeping the caller's currency-symbol, recharge and precision options intact.
 */
export function withBaseGroupRatio(model: PricingModel): PricingModel {
  return {
    ...model,
    enable_groups: [BASE_GROUP_KEY],
    group_ratio: { ...model.group_ratio, [BASE_GROUP_KEY]: 1 },
  }
}

/** Same dynamic pricing options with the group multiplier neutralised. */
export function getBasePriceOptions(
  options: DynamicPriceOptions
): DynamicPriceOptions {
  return { ...options, groupRatioMultiplier: 1 }
}

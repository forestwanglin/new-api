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
import {
  getDynamicPricingSummary,
  isUnconfiguredTaskUsageModel,
} from '@/features/pricing/lib/dynamic-price'
import {
  getDisplayGroupRatio,
  isTokenBasedModel,
} from '@/features/pricing/lib/model-helpers'
import { getSeedanceVideoSpec } from '@/features/pricing/lib/video-price'
import type { PricingModel } from '@/features/pricing/types'
import { DEFAULT_MODEL_REFERENCE_EXCHANGE_RATE } from '@/stores/system-config-store'

import { getModelCategory } from './categories'

/** Reference conversion only; never applied to charged prices. */
export function getReferencePriceMultiplier(
  model: PricingModel,
  referenceExchangeRate = DEFAULT_MODEL_REFERENCE_EXCHANGE_RATE
): number {
  return getModelCategory(model) === 'overseas' ? referenceExchangeRate : 1
}

/** All comparable price entries share the same group multiplier. */
export function getModelDiscountRatio(
  model: PricingModel,
  referenceExchangeRate = DEFAULT_MODEL_REFERENCE_EXCHANGE_RATE
): number | null {
  if (getSeedanceVideoSpec(model) || isUnconfiguredTaskUsageModel(model)) {
    return null
  }
  const dynamic = getDynamicPricingSummary(model, {
    tokenUnit: 'M',
    groupRatioMultiplier: 1,
  })
  if (dynamic) {
    const entries = dynamic.primaryEntries
    if (
      dynamic.isSpecialExpression ||
      entries.length === 0 ||
      entries.some((entry) => !Number.isFinite(entry.value) || entry.value <= 0)
    ) {
      return null
    }
  } else {
    const reference = isTokenBasedModel(model)
      ? model.model_ratio
      : model.model_price
    if (
      typeof reference !== 'number' ||
      !Number.isFinite(reference) ||
      reference <= 0
    ) {
      return null
    }
    if (
      isTokenBasedModel(model) &&
      (!Number.isFinite(model.completion_ratio) || model.completion_ratio < 0)
    ) {
      return null
    }
  }
  const ratio =
    getDisplayGroupRatio(model) /
    getReferencePriceMultiplier(model, referenceExchangeRate)
  return Number.isFinite(ratio) && ratio >= 0 ? ratio : null
}

export function formatModelDiscount(ratio: number): string {
  const tenths = ratio * 10
  if (tenths > 0 && tenths < 0.1) return '<0.1'
  return tenths.toFixed(1).replace(/\.0$/, '')
}

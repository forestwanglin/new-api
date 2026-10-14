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
import { QUOTA_TYPE_VALUES } from '../constants'
import type { PricingModel } from '../types'
import { getDisplayGroupRatio } from './model-helpers'

/**
 * Legacy MAI Seedance models are sold by the second rather than by the
 * request, so they carry a per-second model price and stay outside the token
 * billing matrix. The listed specification is the only one currently sold.
 */
const SEEDANCE_SPECS: Record<string, { version: string; resolution: string }> =
  {
    'sd2.0-480P': { version: '2.0', resolution: '480p' },
    'sd2.0-720P': { version: '2.0', resolution: '720p' },
    'sd2.0-1080P': { version: '2.0', resolution: '1080p' },
    'seedance-2.5': { version: '2.5', resolution: '720p' },
  }

export function getSeedanceVideoSpec(model: PricingModel) {
  if (model.quota_type !== QUOTA_TYPE_VALUES.REQUEST) return undefined
  return SEEDANCE_SPECS[model.model_name]
}

export function formatVideoCNY(amount: number): string {
  return `¥${Number(amount.toFixed(4))}`
}

export function getSeedanceVideoPrice(
  model: PricingModel,
  selectedGroup?: string
) {
  if (!getSeedanceVideoSpec(model)) return undefined
  const base = model.model_price
  if (typeof base !== 'number' || !Number.isFinite(base) || base < 0) {
    return undefined
  }
  const ratio = getDisplayGroupRatio(model, selectedGroup)
  return { base, ratio, sale: base * ratio }
}

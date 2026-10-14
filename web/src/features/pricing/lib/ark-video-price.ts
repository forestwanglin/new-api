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

/**
 * Volcengine Ark video models billed per million video tokens. The declared
 * model name identifies the Ark endpoint even when channel mapping rewrites
 * the upstream name, so the spec is keyed by the model the client sees.
 */
const ARK_VIDEO_MODELS: Record<
  string,
  { version: string; videoRatio: number }
> = {
  'doubao-seedance-2-0-fast-260128': {
    version: '2.0 Fast',
    videoRatio: 22 / 37,
  },
  'doubao-seedance-2-0-mini-260615': {
    version: '2.0 Mini',
    videoRatio: 14 / 23,
  },
}

export function getArkVideoSpec(model: PricingModel) {
  if (model.quota_type !== QUOTA_TYPE_VALUES.TOKEN) return undefined
  return ARK_VIDEO_MODELS[model.model_name]
}

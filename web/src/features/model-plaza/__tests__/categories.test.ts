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
import { expect, it } from 'vitest'

import type { PricingModel } from '@/features/pricing/types'

import { getModelCategory, getModelVendorKey } from '../categories'

const model: PricingModel = {
  id: 1,
  model_name: 'custom-name',
  quota_type: 0,
  model_ratio: 1,
  completion_ratio: 1,
  enable_groups: ['default'],
}

it.each(['360', '快手', 'Kling', '即梦', 'Jimeng', 'Vidu'])(
  'groups the built-in or alias vendor %s with domestic models',
  (vendor_name) => {
    expect(getModelCategory({ ...model, vendor_name })).toBe('domestic')
  }
)

it.each(['Cloudflare', 'Azure'])(
  'groups the vendor %s with overseas models',
  (vendor_name) => {
    expect(getModelCategory({ ...model, vendor_name })).toBe('overseas')
  }
)

it.each([undefined, '', '  ', 'Private Service', 'OpenAI-compatible'])(
  'keeps an absent or unrecognized vendor %s in other models',
  (vendor_name) => {
    expect(
      getModelCategory({ ...model, model_name: 'gpt-custom', vendor_name })
    ).toBe('other')
  }
)

it('preserves a negative API vendor ID as its filter identity', () => {
  expect(
    getModelVendorKey({ ...model, vendor_id: -1012, vendor_name: 'OpenAI' })
  ).toBe('-1012')
})

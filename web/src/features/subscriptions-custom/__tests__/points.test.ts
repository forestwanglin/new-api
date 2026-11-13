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

import { formatOfferPoints, offerPointAmounts } from '../plans'
import { configuredPlan } from './fixtures'

it('combines only matching point types and floors the configured renewal bonus', () => {
  const plan = {
    ...configuredPlan,
    paid_points: '101',
    bonus_points: '2',
    bonus_point_type: configuredPlan.paid_point_type,
    auto_bonus_point_type: configuredPlan.paid_point_type,
  }
  expect(formatOfferPoints(plan, 'zh-CN')).toBe('103 通用积分')
  expect(offerPointAmounts(plan, true)).toEqual([
    { id: '1', name: '通用积分', amount: 115n },
  ])
})
it('keeps different point types separate and omits a reward that rounds to zero', () => {
  const plan = {
    ...configuredPlan,
    paid_points: '1',
    bonus_points: '2',
    auto_renew_bonus_bps: 1,
  }
  expect(formatOfferPoints(plan, 'zh-CN')).toBe('1 通用积分 + 2 GPT积分')
  expect(offerPointAmounts(plan, true)).toEqual([
    { id: '1', name: '通用积分', amount: 1n },
    { id: '2', name: 'GPT积分', amount: 2n },
  ])
})

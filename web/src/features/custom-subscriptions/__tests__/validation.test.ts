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

import {
  createPlanSchema,
  defaultPlanValues,
  toPlanInput,
  yuanToMinor,
  minorToYuan,
  autoBonusPoints,
} from '../lib/schema'

const types = [{ id: '1', code: 'GENERAL', name: 'General' }]
const valid = {
  ...defaultPlanValues,
  code: 'basic-month',
  title: 'Basic',
  tier_code: 'basic',
  price_yuan: '0.29',
  paid_points: '9007199254740993',
  paid_point_type_id: '1',
}

describe('custom subscription precision and validation', () => {
  it('converts yuan and minor units exactly above the JS safe integer range', () => {
    expect(yuanToMinor('90071992547409.93')).toBe('9007199254740993')
    expect(minorToYuan('9007199254740993')).toBe('90071992547409.93')
    expect(yuanToMinor('0.29')).toBe('29')
    expect(() => yuanToMinor('1.001')).toThrow()
  })
  it('preserves large points and explicit false/zero/null in the complete payload', () => {
    const input = toPlanInput(createPlanSchema(types).parse(valid))
    expect(input).toMatchObject({
      price_amount_minor: '29',
      paid_points: '9007199254740993',
      auto_renew_enabled: false,
      auto_renew_bonus_bps: 0,
      bonus_points: '0',
      bonus_point_type_id: null,
      auto_bonus_point_type_id: null,
      sort_order: 0,
      enabled: true,
      duration_months: 1,
      currency: 'CNY',
      benefits: [],
    })
    expect(input).not.toHaveProperty('price_yuan')
  })
  it.each(['-1', '1.2', '9223372036854775808'])(
    'rejects invalid paid points %s',
    (paid_points) => {
      expect(
        createPlanSchema(types).safeParse({ ...valid, paid_points }).success
      ).toBe(false)
    }
  )
  it('requires a loaded catalog and existing types for nonzero bonuses', () => {
    expect(createPlanSchema([]).safeParse(valid).success).toBe(false)
    expect(
      createPlanSchema(types).safeParse({
        ...valid,
        bonus_points: '1',
        bonus_point_type_id: '',
      }).success
    ).toBe(false)
    expect(
      createPlanSchema(types).safeParse({ ...valid, paid_point_type_id: '99' })
        .success
    ).toBe(false)
  })
  it('floors automatic renewal bonus and rejects overflowing total points', () => {
    expect(autoBonusPoints('101', '2', 1000)).toBe('10')
    expect(
      createPlanSchema(types).safeParse({
        ...valid,
        paid_points: '9223372036854775807',
        bonus_points: '1',
        bonus_point_type_id: '1',
      }).success
    ).toBe(false)
  })
  it('starts with no commercial price or paid points', () => {
    expect(defaultPlanValues.price_yuan).toBe('')
    expect(defaultPlanValues.paid_points).toBe('')
    expect(createPlanSchema(types).safeParse(defaultPlanValues).success).toBe(
      false
    )
  })
})

describe('automatic renewal reward configuration independent of switch', () => {
  it('preserves configured rewards in the payload while automatic renewal is off', () => {
    const values = {
      ...valid,
      auto_renew_bonus_bps: '1250',
      auto_bonus_point_type_id: '1',
    }
    const input = toPlanInput(createPlanSchema(types).parse(values))
    expect(input).toMatchObject({
      auto_renew_enabled: false,
      auto_renew_bonus_bps: 1250,
      auto_bonus_point_type_id: '1',
    })
  })
  it.each(['', '99'])(
    'requires an existing reward type %s even when automatic renewal is off',
    (auto_bonus_point_type_id) => {
      expect(
        createPlanSchema(types).safeParse({
          ...valid,
          auto_renew_bonus_bps: '1250',
          auto_bonus_point_type_id,
        }).success
      ).toBe(false)
    }
  )
  it('checks configured reward overflow and exact floor boundaries even when automatic renewal is off', () => {
    expect(
      createPlanSchema(types).safeParse({
        ...valid,
        paid_points: '9222449791875588249',
        auto_renew_bonus_bps: '1',
        auto_bonus_point_type_id: '1',
      }).success
    ).toBe(true)
    expect(
      createPlanSchema(types).safeParse({
        ...valid,
        paid_points: '9222449791875588250',
        auto_renew_bonus_bps: '1',
        auto_bonus_point_type_id: '1',
      }).success
    ).toBe(false)
  })
  it('normalizes a zero reward rate to a null type regardless of the switch', () => {
    for (const auto_renew_enabled of [false, true]) {
      expect(
        toPlanInput({
          ...valid,
          auto_renew_enabled,
          auto_bonus_point_type_id: '1',
        })
      ).toMatchObject({
        auto_renew_bonus_bps: 0,
        auto_bonus_point_type_id: null,
      })
    }
  })
})

describe('subscription scheduling priority', () => {
  it('round-trips independent priority and preserves explicit zero', () => {
    const schema = createPlanSchema(types)
    expect(
      toPlanInput(schema.parse({ ...valid, priority: '12' }))
    ).toMatchObject({ priority: 12 })
    expect(
      toPlanInput(schema.parse({ ...valid, priority: '0' }))
    ).toMatchObject({ priority: 0 })
  })
  it.each(['-1', '1.5', '2147483648', ''])(
    'rejects invalid priority %s',
    (priority) => {
      expect(
        createPlanSchema(types).safeParse({ ...valid, priority }).success
      ).toBe(false)
    }
  )
})

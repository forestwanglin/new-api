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
  pointRuleSchema,
  pointCodeSchema,
  pointPrioritySchema,
} from '../lib/schema'

describe('point rule validation', () => {
  it.each([
    '',
    ' gpt-*',
    'gpt-* ',
    'gpt\nname',
    'gpt\u0000name',
    'a'.repeat(256),
  ])('rejects invalid model expression %j', (match_value) => {
    expect(
      pointRuleSchema.safeParse({
        match_type: 'PATTERN',
        match_value,
        enabled: true,
      }).success
    ).toBe(false)
  })
  it('preserves literal case, wildcard characters and explicit false', () => {
    expect(
      pointRuleSchema.parse({
        match_type: 'EXACT',
        match_value: 'Vendor/GPT.[x]*?',
        enabled: false,
      })
    ).toEqual({
      match_type: 'EXACT',
      match_value: 'Vendor/GPT.[x]*?',
      enabled: false,
    })
  })
  it('counts Unicode code points rather than UTF-16 units', () => {
    expect(
      pointRuleSchema.safeParse({
        match_type: 'PATTERN',
        match_value: '😀'.repeat(255),
        enabled: true,
      }).success
    ).toBe(true)
  })
  it('rejects unknown modes and missing enabled', () => {
    expect(
      pointRuleSchema.safeParse({
        match_type: 'REGEX',
        match_value: 'gpt-*',
        enabled: true,
      }).success
    ).toBe(false)
    expect(
      pointRuleSchema.safeParse({ match_type: 'EXACT', match_value: 'gpt-4' })
        .success
    ).toBe(false)
  })
})

describe('point type validation', () => {
  it.each(['', 'image', '1IMAGE', 'IMAGE-CREDIT', ' IMAGE', 'I'.repeat(33)])(
    'rejects invalid immutable code %j',
    (code) => {
      expect(pointCodeSchema.safeParse(code).success).toBe(false)
    }
  )
  it.each(['', '1.5', '2147483648', '-2147483649', '1e2'])(
    'rejects invalid priority %j',
    (priority) => {
      expect(pointPrioritySchema.safeParse(priority).success).toBe(false)
    }
  )
  it.each(['-2147483648', '0', '2147483647'])(
    'accepts signed int32 priority boundary %j',
    (priority) => {
      expect(pointPrioritySchema.safeParse(priority).success).toBe(true)
    }
  )
})

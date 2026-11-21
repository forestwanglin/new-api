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

import { resolvePointName } from '../lib/point-name'
import { pointNameSchema, pointPolicySchema } from '../lib/schema'

const condition = {
  kind: 'MODEL',
  match_type: 'PATTERN',
  match_value: 'gpt-*',
  enabled: true,
}
describe('grouped point policy validation', () => {
  it('accepts model and channel OR groups under an AND root', () => {
    const policy = {
      version: 1,
      operator: 'AND',
      groups: [
        { operator: 'OR', enabled: true, conditions: [condition] },
        {
          operator: 'OR',
          enabled: true,
          conditions: [{ kind: 'CHANNEL', channel_id: '12', enabled: true }],
        },
      ],
    }
    expect(pointPolicySchema.parse(policy)).toEqual(policy)
  })
  it('rejects enabled groups with only disabled conditions', () => {
    expect(
      pointPolicySchema.safeParse({
        version: 1,
        operator: 'AND',
        groups: [
          {
            operator: 'OR',
            enabled: true,
            conditions: [{ ...condition, enabled: false }],
          },
        ],
      }).success
    ).toBe(false)
  })
  it('rejects noncanonical IDs and irrelevant channel fields', () => {
    for (const item of [
      { kind: 'CHANNEL', channel_id: '0', enabled: true },
      { kind: 'CHANNEL', channel_id: '', enabled: true },
      { kind: 'CHANNEL', channel_id: 'abc', enabled: true },
      { kind: 'CHANNEL', channel_id: '-1', enabled: true },
      { kind: 'CHANNEL', channel_id: '9223372036854775808', enabled: true },
      { kind: 'CHANNEL', channel_id: '012', enabled: true },
      { kind: 'CHANNEL', channel_id: '12', match_value: '*', enabled: true },
    ]) {
      expect(
        pointPolicySchema.safeParse({
          version: 1,
          operator: 'OR',
          groups: [{ operator: 'OR', enabled: true, conditions: [item] }],
        }).success
      ).toBe(false)
    }
  })
  it('allows empty policies and disabled draft groups', () => {
    expect(
      pointPolicySchema.safeParse({ version: 1, operator: 'OR', groups: [] })
        .success
    ).toBe(true)
    expect(
      pointPolicySchema.safeParse({
        version: 1,
        operator: 'OR',
        groups: [{ operator: 'AND', enabled: false, conditions: [] }],
      }).success
    ).toBe(true)
  })
  it('validates names by Unicode length without trimming', () => {
    expect(pointNameSchema.safeParse('新积分名称').success).toBe(true)
    for (const value of ['', ' New', 'New ', 'a\nname', '点'.repeat(65)]) {
      expect(pointNameSchema.safeParse(value).success).toBe(false)
    }
    expect(pointNameSchema.safeParse('😀'.repeat(64)).success).toBe(true)
  })
})
describe('current point name resolution', () => {
  const catalog = [
    { id: '1', code: 'GENERAL', name: 'Renamed credits' },
    { id: '2', code: 'GPT', name: 'Special credits' },
  ]
  it('prefers stable IDs and preserves missing-type historical names', () => {
    expect(
      resolvePointName(catalog, { id: '1', code: 'GPT', name: 'Old' })
    ).toBe('Renamed credits')
    expect(resolvePointName(catalog, { code: 'GENERAL', name: 'Old' })).toBe(
      'Renamed credits'
    )
    expect(
      resolvePointName(catalog, {
        id: '9',
        code: 'GENERAL',
        name: 'Historical',
      })
    ).toBe('Historical')
    expect(resolvePointName([], { code: 'OLD', name: '' })).toBe('OLD')
  })
})

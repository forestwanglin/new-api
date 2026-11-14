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
import { createInstance } from 'i18next'
import { expect, test } from 'vitest'

import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import vi from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'

import type { AuditLog } from '../../audit/api'
import { buildAuditDetails } from '../../audit/lib/audit-details'
import { renderAuditContent } from '../format'

const params = {
  target_user_id: '42',
  target_username: 'point-owner',
  point_type_id: '8',
  point_type_code: 'FUTURE',
  point_type_name: 'Future points',
  mode: 'subtract',
  amount: '9007199254740993',
  from: '9007199254740987',
  to: '-6',
  adjustment_request_id: 'intent-1',
}
const entry: AuditLog = {
  event_id: 'event-1',
  user_id: 7,
  username: 'admin',
  actor_role: 10,
  created_at: 1,
  category: 'operation',
  action: 'user.points_subtract',
  token_ref: '',
  ip: '127.0.0.1',
  user_agent: '',
  method: 'POST',
  route: '/api/user/:id/points',
  status: 200,
  success: true,
  request_id: 'http-1',
  content: '',
  other: { op: { action: 'user.points_subtract', params } },
}

test('usage and audit summaries preserve point type, exact amounts and negative committed balances', async () => {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en } })
  const text = renderAuditContent(
    { op: { action: entry.action, params } },
    i18n.t
  )
  expect(text).toContain('Future points (FUTURE)')
  expect(text).toContain('9007199254740993')
  expect(text).toContain('9007199254740987 → -6')
  expect(text).not.toMatch(/[$¥]/)
  const detail = buildAuditDetails(entry, i18n.t)
  expect(detail.operation?.fields).toContainEqual({
    label: 'Points before adjustment',
    value: '9007199254740987',
  })
  expect(detail.operation?.fields).toContainEqual({
    label: 'Points after adjustment',
    value: '-6',
  })
  expect(detail.operation?.fields).toContainEqual({
    label: 'Point adjustment request ID',
    value: 'intent-1',
    copyable: true,
  })
})

test('failed audit does not display committed balance changes even when malformed metadata contains them', async () => {
  const i18n = createInstance()
  await i18n.init({ lng: 'en' })
  const detail = buildAuditDetails(
    {
      ...entry,
      success: false,
      other: {
        op: {
          action: entry.action,
          params: { ...params, failure_reason: 'request_conflict' },
        },
      },
    },
    i18n.t
  )
  expect(detail.operation?.description).toContain(
    'Point adjustment request conflicts with an existing request'
  )
  expect(detail.operation?.description).not.toContain('→')
  expect(detail.operation?.fields.map((field) => field.label)).not.toContain(
    'Points before adjustment'
  )
})

test('replay audit states that the adjustment was not applied again', async () => {
  const i18n = createInstance()
  await i18n.init({ lng: 'en' })
  const detail = buildAuditDetails(
    {
      ...entry,
      action: 'user.points_replay',
      other: {
        op: {
          action: 'user.points_replay',
          params: { ...params, replayed: true },
        },
      },
    },
    i18n.t
  )
  expect(detail.summary).toContain('Replay point adjustment')
  expect(detail.operation?.description).toContain(
    'No additional points were changed'
  )
})

test.each(Object.entries({ en, fr, ja, ru, vi, zh, zhTW }))(
  'point operation has localized text in %s and supports arbitrary types',
  async (lng, catalog) => {
    const i18n = createInstance()
    await i18n.init({ lng, resources: { [lng]: catalog } })
    const text = renderAuditContent(
      {
        op: {
          action: 'user.points_add',
          params: {
            ...params,
            mode: 'add',
            point_type_code: 'NEW',
            point_type_name: '新增积分',
          },
        },
      },
      i18n.t
    )
    expect(text).toContain('新增积分 (NEW)')
    expect(text).toContain('9007199254740993')
    expect(catalog.translation).toHaveProperty('Points before adjustment')
    expect(catalog.translation).toHaveProperty('Increase user points')
    expect(text).toContain(catalog.translation['Increase user points'])
  }
)

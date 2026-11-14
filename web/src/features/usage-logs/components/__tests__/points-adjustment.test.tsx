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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, test, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'

import type { AuditLog } from '../../audit/api'
import { AuditLogDetailsDialog } from '../../audit/components/audit-log-details-dialog'
import type { UsageLog } from '../../data/schema'
import { DetailsDialog } from '../dialogs/details-dialog'

vi.mock('@lobehub/icons', () => ({}))
vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
})
afterEach(cleanup)

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
const op = { action: 'user.points_subtract', params }

test.each(['usage', 'audit'] as const)(
  '%s detail shows precise point adjustment fields and reacts to language changes',
  async (kind) => {
    const i18n = createInstance()
    await i18n.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: { en, zh },
      interpolation: { escapeValue: false },
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    client.setQueryData(['status'], {}, { updatedAt: Date.now() + 60_000 })
    const log: UsageLog = {
      id: 1,
      user_id: 42,
      created_at: 1,
      type: 1,
      content: 'export fallback',
      username: 'point-owner',
      token_name: '',
      model_name: '',
      quota: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      use_time: 0,
      is_stream: false,
      channel: 0,
      channel_name: '',
      token_id: 0,
      group: '',
      ip: '',
      request_id: 'http-1',
      upstream_request_id: '',
      other: JSON.stringify({ op }),
    }
    const audit: AuditLog = {
      event_id: 'event-1',
      user_id: 7,
      username: 'admin',
      actor_role: 10,
      created_at: 1,
      category: 'operation',
      action: op.action,
      token_ref: '',
      ip: '',
      user_agent: '',
      method: 'POST',
      route: '/api/user/:id/points',
      status: 200,
      success: true,
      request_id: 'http-1',
      content: 'export fallback',
      other: { op },
    }
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          {kind === 'usage' ? (
            <DetailsDialog
              log={log}
              isAdmin={false}
              isRoot={false}
              open
              onOpenChange={() => undefined}
            />
          ) : (
            <AuditLogDetailsDialog entry={audit} />
          )}
        </QueryClientProvider>
      </I18nextProvider>
    )
    if (kind === 'audit') {
      await userEvent.click(screen.getByRole('button', { name: 'Details' }))
    }
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('Points adjustment details')).toBeVisible()
    expect(dialog.getByText('Points before adjustment')).toBeVisible()
    expect(dialog.getByText('9007199254740987')).toBeVisible()
    expect(dialog.getByText('Points after adjustment')).toBeVisible()
    expect(dialog.getByText('-6')).toBeVisible()
    expect(dialog.getByText('9007199254740993')).toBeVisible()
    expect(dialog.getByText('intent-1')).toBeVisible()
    expect(dialog.getByText('Future points (FUTURE)')).toBeVisible()
    expect(dialog.queryByText('Token operation details')).toBeNull()
    await act(() => i18n.changeLanguage('zh'))
    expect(dialog.getByText('积分调整详情')).toBeVisible()
    expect(dialog.getByText('调整前积分')).toBeVisible()
    expect(dialog.getByText('调整后积分')).toBeVisible()
    expect(dialog.queryByText('Points adjustment details')).toBeNull()
    client.clear()
  }
)

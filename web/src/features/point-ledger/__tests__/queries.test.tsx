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
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import viLocale from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { PointLedger } from '..'
import { getPointLedger } from '../api'
import type {
  PointLedgerItem,
  PointLedgerPage,
  PointLedgerScope,
} from '../types'

const row: PointLedgerItem = {
  id: '9007199254740993',
  transaction_id: '10',
  account_id: '2',
  account_version: '3',
  freeze_id: null,
  user_id: '1',
  point_type_id: '99',
  point_type_code: '',
  point_type_name: '',
  action: 'FUTURE_ACTION',
  biz_type: 'MODEL_REQUEST',
  biz_id: 'request-1',
  related_transaction_id: null,
  remark: '<script>not HTML</script>',
  available_delta: '-20',
  frozen_delta: '10',
  available_before: '9223372036854775807',
  available_after: '9223372036854775787',
  frozen_before: '0',
  frozen_after: '10',
  created_at: 1794470400000,
}
const page: PointLedgerPage = {
  page: 1,
  page_size: 20,
  total: 21,
  items: [row],
  point_types: [{ id: '1', code: 'GENERAL', name: 'General points' }],
}
function response(data: PointLedgerPage) {
  return { data: { success: true, data } }
}
function setup(scope: PointLedgerScope = 'self') {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'first', role: 10 })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <PointLedger scope={scope} />
    </QueryClientProvider>
  )
  return client
}
afterEach(() => useAuthStore.getState().auth.reset())

describe('point ledger queries', () => {
  it('preserves int64 snapshots, raw unknown actions and non-link business references in details', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(response(page))
    setup()
    expect(await screen.findByText('FUTURE_ACTION')).toBeVisible()
    expect(screen.getByText('9,223,372,036,854,775,787')).toBeVisible()
    expect(screen.getByText('99')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'View details' }))
    const details = await screen.findByRole('dialog')
    expect(within(details).getByText('9007199254740993')).toBeVisible()
    expect(within(details).getByText('9,223,372,036,854,775,807')).toBeVisible()
    expect(within(details).getByText('<script>not HTML</script>')).toBeVisible()
    expect(within(details).getByText('request-1')).toBeVisible()
    expect(within(details).queryByRole('link')).not.toBeInTheDocument()
    expect(details.querySelector('script')).toBeNull()
    expect(screen.queryByLabelText('User ID')).not.toBeInTheDocument()
  })
  it('resets pagination on administrator filter and rejects an invalid user ID without a request', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(response(page))
    setup('admin')
    await screen.findByText('FUTURE_ACTION')
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith('/api/points/ledger', {
        params: { p: 2, page_size: 20 },
      })
    )
    await screen.findByRole('button', { name: 'Search' })
    fireEvent.change(screen.getByLabelText('User ID'), {
      target: { value: '9007199254740993' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith('/api/points/ledger', {
        params: { p: 1, page_size: 20, user_id: '9007199254740993' },
      })
    )
    const count = get.mock.calls.length
    fireEvent.change(screen.getByLabelText('User ID'), {
      target: { value: '-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid point ledger filters'
    )
    expect(get).toHaveBeenCalledTimes(count)
  })
  it('shows empty results after retrying a failed request', async () => {
    vi.spyOn(api, 'get')
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(response({ ...page, total: 0, items: [] }))
    setup()
    expect(screen.getByText('Loading...')).toBeVisible()
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No point ledger entries')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Go to next page' })
    ).toBeDisabled()
  })
  it('submits the selected local time range as millisecond boundaries', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(response(page))
    setup()
    await screen.findByText('FUTURE_ACTION')
    fireEvent.change(screen.getByLabelText('Start time'), {
      target: { value: '2026-11-12T08:00' },
    })
    fireEvent.change(screen.getByLabelText('End time (exclusive)'), {
      target: { value: '2026-11-12T09:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith('/api/points/ledger/self', {
        params: {
          p: 1,
          page_size: 20,
          start_timestamp: new Date(2026, 10, 12, 8).getTime(),
          end_timestamp: new Date(2026, 10, 12, 9).getTime(),
        },
      })
    )
  })
  it('rejects a reversed time range before requesting another page', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(response(page))
    setup()
    await screen.findByText('FUTURE_ACTION')
    const requestCount = get.mock.calls.length
    fireEvent.change(screen.getByLabelText('Start time'), {
      target: { value: '2026-11-12T09:00' },
    })
    fireEvent.change(screen.getByLabelText('End time (exclusive)'), {
      target: { value: '2026-11-12T08:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid point ledger filters'
    )
    expect(get).toHaveBeenCalledTimes(requestCount)
  })
  it('opens details from the keyboard and dismisses them with Escape', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(response(page))
    const user = userEvent.setup()
    setup()
    const detailsButton = await screen.findByRole('button', {
      name: 'View details',
    })
    detailsButton.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog')).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(detailsButton).toHaveFocus()
  })
  it('clears the displayed account records while the next authenticated identity is loading', async () => {
    let resolveNext: ((value: ReturnType<typeof response>) => void) | undefined
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce(response(page))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNext = resolve
          })
      )
    setup()
    await screen.findByText('FUTURE_ACTION')
    act(() =>
      useAuthStore
        .getState()
        .auth.setUser({ id: 2, username: 'second', role: 1 })
    )
    expect(screen.queryByText('FUTURE_ACTION')).not.toBeInTheDocument()
    expect(screen.getByText('Loading...')).toBeVisible()
    await act(async () =>
      resolveNext?.(response({ ...page, total: 0, items: [] }))
    )
    expect(await screen.findByText('No point ledger entries')).toBeVisible()
  })
  it('never sends a user selector to the personal endpoint and propagates business failures', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(response(page))
    await getPointLedger('self', { p: 1, page_size: 20, user_id: '2' })
    expect(get).toHaveBeenCalledWith('/api/points/ledger/self', {
      params: { p: 1, page_size: 20 },
    })
    get.mockResolvedValueOnce({
      data: { success: false, message: 'Failed to load point ledger' },
    })
    await expect(
      getPointLedger('self', { p: 1, page_size: 20 })
    ).rejects.toThrow('Failed to load point ledger')
  })
})

it('reacts to language changes without losing exact integer precision', async () => {
  const translations = createInstance()
  await translations.init({
    lng: 'en',
    resources: { en, fr, ja, ru, vi: viLocale, zhCN: zh, zhTW },
    initAsync: false,
  })
  vi.spyOn(api, 'get').mockResolvedValue(response(page))
  useAuthStore.getState().auth.setUser({ id: 1, username: 'first', role: 10 })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <I18nextProvider i18n={translations}>
      <QueryClientProvider client={client}>
        <PointLedger scope='self' />
      </QueryClientProvider>
    </I18nextProvider>
  )
  expect(await screen.findByText('9,223,372,036,854,775,787')).toBeVisible()
  await act(() => translations.changeLanguage('fr'))
  expect(
    await screen.findByText(
      '9\u202f223\u202f372\u202f036\u202f854\u202f775\u202f787',
      { normalizer: (value) => value }
    )
  ).toBeVisible()
  expect(screen.getByLabelText('Heure de début')).toBeVisible()
})

it.each([
  ['en', en, 'Point ledger details', 'Transaction ID', 'Start time'],
  ['zhCN', zh, '积分流水详情', '交易 ID', '开始时间'],
  ['zhTW', zhTW, '積分流水詳情', '交易 ID', '開始時間'],
  ['fr', fr, 'Détail des points', 'ID de transaction', 'Heure de début'],
  ['ru', ru, 'Подробности баллов', 'ID транзакции', 'Время начала'],
  ['ja', ja, 'ポイント履歴の詳細', '取引 ID', '開始時刻'],
  [
    'vi',
    viLocale,
    'Chi tiết lịch sử điểm',
    'ID giao dịch',
    'Thời gian bắt đầu',
  ],
])(
  'provides ledger labels for %s',
  (_language, resource, details, transaction, start) => {
    const words = (resource as typeof en).translation
    expect(words['Point ledger details']).toBe(details)
    expect(words['Transaction ID']).toBe(transaction)
    expect(words['Start time']).toBe(start)
  }
)

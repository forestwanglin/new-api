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
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { useMemo } from 'react'
import { I18nextProvider } from 'react-i18next'
import { expect, it } from 'vitest'

import { toIntlLocale } from '@/i18n/languages'
import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import vi from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'
import { formatNumber } from '@/lib/format'

import { usageLogSchema } from '../../data/schema'
import { useCommonLogsColumns } from '../columns/common-logs-columns'

const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en, fr, ja, ru, vi, zhCN: zh, zhTW },
  initAsync: false,
})
const committed = {
  version: 1,
  call_id: 'call-1',
  event_id: 'event-1',
  status: 'committed',
  total_points: '9007199254741000',
  items: [
    {
      point_type_id: '1',
      code: 'GPT',
      name: 'GPT points',
      points: '9007199254740993',
    },
    {
      point_type_id: '2',
      code: 'GENERAL',
      name: 'General points',
      points: '7',
    },
  ],
}

function Fixture(props: { billing?: unknown }) {
  const columns = useCommonLogsColumns(false, false)
  const data = useMemo(
    () => [
      usageLogSchema.parse({
        id: 1,
        user_id: 1,
        created_at: 1,
        type: 2,
        content: '',
        quota: 1,
        other: JSON.stringify({ points_billing: props.billing }),
      }),
    ],
    [props.billing]
  )
  const table = useReactTable({
    columns,
    data,
    getCoreRowModel: getCoreRowModel(),
  })
  const cell = table
    .getRowModel()
    .rows[0].getAllCells()
    .find((item) => item.column.id === 'consumed_points')
  return (
    <>
      <ol aria-label='Column order'>
        {table.getAllColumns().map((column) => (
          <li key={column.id}>{column.id}</li>
        ))}
      </ol>
      <h2 data-testid='points-heading'>
        {String(table.getColumn('consumed_points')?.columnDef.header ?? '')}
      </h2>
      <div data-testid='points'>
        {cell && flexRender(cell.column.columnDef.cell, cell.getContext())}
      </div>
    </>
  )
}
function view(billing?: unknown) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Fixture billing={billing} />
    </I18nextProvider>
  )
}

it('puts consumed points immediately after cost and preserves every split integer', async () => {
  await i18n.changeLanguage('en')
  view(committed)
  const order = within(screen.getByRole('list', { name: 'Column order' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent)
  expect(order[order.indexOf('quota') + 1]).toBe('consumed_points')
  const cell = screen.getByTestId('points')
  expect(within(cell).getByText('9,007,199,254,740,993')).toBeVisible()
  expect(within(cell).getByText('7')).toBeVisible()
  expect(within(cell).getByText('GPT points')).toBeVisible()
  expect(within(cell).getByText('General points')).toBeVisible()
})
it.each([
  ['historic', undefined, '—'],
  ['zero', { ...committed, total_points: '0', items: [] }, '0'],
  ['pending', { ...committed, status: 'pending' }, 'Points settlement pending'],
  ['error', { ...committed, status: 'error' }, 'Points settlement failed'],
  ['invalid number', { ...committed, total_points: 10 }, '—'],
  ['fractional value', { ...committed, total_points: '1.5' }, '—'],
  [
    'invalid item',
    { ...committed, items: [{ ...committed.items[0], points: 'invalid' }] },
    '—',
  ],
  ['mismatched total', { ...committed, total_points: '1' }, '—'],
  ['unknown version', { ...committed, version: 2 }, '—'],
])(
  'shows %s explicitly instead of inventing a successful zero',
  async (_name, value, expected) => {
    await i18n.changeLanguage('en')
    view(value)
    expect(screen.getByTestId('points')).toHaveTextContent(expected)
  }
)
it('displays refunds as negative contributions and reveals every additional type accessibly', async () => {
  await i18n.changeLanguage('en')
  const user = userEvent.setup()
  view({
    ...committed,
    total_points: '-6',
    items: [
      { point_type_id: '1', code: 'A', name: 'First', points: '-1' },
      { point_type_id: '2', code: 'B', name: 'Second', points: '-2' },
      {
        point_type_id: '3',
        code: 'C',
        name: 'VeryLongTypeName'.repeat(8),
        points: '-3',
      },
    ],
  })
  expect(screen.getByText('-1')).toBeVisible()
  await user.click(
    screen.getByRole('button', {
      name: i18n.t('More point types', { count: 1 }),
    })
  )
  const details = await screen.findByRole('dialog')
  expect(within(details).getByText('-3')).toBeVisible()
  expect(within(details).getByText(/VeryLongTypeName/)).toBeVisible()
})
it('reacts to all seven interface languages without losing integer precision', async () => {
  await i18n.changeLanguage('en')
  view(committed)
  const headings: Record<string, string> = {
    zhCN: '消耗积分',
    zhTW: '消耗積分',
    en: 'Consumed points',
    fr: 'Points consommés',
    ru: 'Потраченные баллы',
    ja: '消費ポイント',
    vi: 'Điểm đã tiêu thụ',
  }
  for (const language of ['zhCN', 'zhTW', 'en', 'fr', 'ru', 'ja', 'vi']) {
    await act(async () => {
      await i18n.changeLanguage(language)
    })
    expect(screen.getByTestId('points-heading')).toHaveTextContent(
      headings[language]
    )
    expect(
      screen.getByText(
        formatNumber(9007199254740993n, toIntlLocale(language)),
        { normalizer: (text) => text }
      )
    ).toBeVisible()
  }
})

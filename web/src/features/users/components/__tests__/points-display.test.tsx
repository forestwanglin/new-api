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
import { act, cleanup, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { toIntlLocale } from '@/i18n/languages'
import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import vi from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'
import { formatNumber } from '@/lib/format'

import type { UserPointBalance } from '../../types'
import { UserPointsCell } from '../user-points-cell'
import { useUsersColumns } from '../users-columns'

const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en, fr, ja, ru, vi, zhCN: zh, zhTW },
  initAsync: false,
})
beforeEach(async () => {
  await i18n.changeLanguage('en')
})
afterEach(cleanup)
const general = {
  code: 'GENERAL',
  name: '通用积分',
  available_points: '12000',
  frozen_points: '2000',
}
const gpt = {
  code: 'GPT',
  name: 'GPT 专用积分',
  available_points: '5000',
  frozen_points: '0',
}
function view(balances?: UserPointBalance[]) {
  return render(
    <I18nextProvider i18n={i18n}>
      <UserPointsCell balances={balances} />
    </I18nextProvider>
  )
}

it.each([
  undefined,
  [],
  [{ ...general, available_points: '0', frozen_points: '0' }],
])('shows a dash for missing or zero holdings: %j', (balances) => {
  view(balances)
  expect(screen.getByText('—')).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('lists every held point type on its own row as name: available/pending-release', () => {
  view([general, { ...gpt, available_points: '0', frozen_points: '15' }])
  expect(screen.getByText('通用积分：12,000/2,000')).toBeVisible()
  expect(screen.getByText('GPT 专用积分：0/15')).toBeVisible()
  expect(screen.queryByText('12,015')).not.toBeInTheDocument()
})

it('sorts general points first and keeps frozen-only holdings visible', () => {
  view([
    { code: 'GPT', name: 'GPT 专用积分', available_points: '0', frozen_points: '15' },
    { code: 'DS', name: 'Future point type', available_points: '7', frozen_points: '0' },
    general,
  ])
  const rows = screen.getAllByText(/：/)
  expect(rows[0]).toHaveTextContent('通用积分：12,000/2,000')
  expect(rows[1]).toHaveTextContent('GPT 专用积分：0/15')
  expect(rows[2]).toHaveTextContent('Future point type：7/0')
})

it('hides holdings where both available and frozen are zero', () => {
  view([
    general,
    { code: 'GPT', name: 'GPT 专用积分', available_points: '0', frozen_points: '0' },
  ])
  expect(screen.getByText('通用积分：12,000/2,000')).toBeVisible()
  expect(screen.queryByText(/GPT 专用积分/)).not.toBeInTheDocument()
})

it.each(['en', 'fr', 'ru', 'ja', 'vi', 'zhCN', 'zhTW'])(
  'preserves int64 precision using the %s interface locale',
  async (language) => {
    await i18n.changeLanguage(language)
    view([
      {
        ...general,
        available_points: '9223372036854775807',
        frozen_points: '-9223372036854775808',
      },
    ])
    const locale = toIntlLocale(language)
    const available = new Intl.NumberFormat(locale).format(9223372036854775807n)
    const frozen = new Intl.NumberFormat(locale).format(-9223372036854775808n)
    expect(
      screen.getByText(`通用积分：${available}/${frozen}`, {
        normalizer: (text) => text,
      })
    ).toBeVisible()
  }
)

it('preserves configured type names while translating number grouping', async () => {
  view([general])
  expect(screen.getByText('通用积分：12,000/2,000')).toBeVisible()
  await act(() => i18n.changeLanguage('fr'))
  expect(
    screen.getByText(/通用积分：12\u202f000\/2\u202f000/, {
      normalizer: (text) => text,
    })
  ).toBeVisible()
})

it('adds a nonsortable points column immediately after quota and after it on mobile', () => {
  function Columns() {
    const columns = useUsersColumns()
    const quotaIndex = columns.findIndex((column) => column.id === 'quota')
    const points = columns[quotaIndex + 1]
    expect(points.id).toBe('points')
    expect(points.enableSorting).toBe(false)
    expect(points.enableColumnFilter).toBe(false)
    expect(points.meta?.mobileOrder).toBe(45)
    expect(points.meta?.label).toBe('Points')
    return null
  }
  render(
    <I18nextProvider i18n={i18n}>
      <Columns />
    </I18nextProvider>
  )
})

it('extends ordinary number formatting without changing decimals, nulls or NaN', () => {
  expect(formatNumber(1234.567, 'en')).toBe('1,234.57')
  expect(formatNumber(null, 'en')).toBe('-')
  expect(formatNumber(Number.NaN, 'en')).toBe('-')
  expect(formatNumber(9007199254740993n, 'en')).toBe('9,007,199,254,740,993')
})

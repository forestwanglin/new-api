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
import { useTranslation } from 'react-i18next'

import { usePointName } from '@/features/points/lib/point-name-context'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { UserPointBalance } from '../types'

type UserPointsCellProps = {
  balances?: UserPointBalance[]
}

export function UserPointsCell(props: UserPointsCellProps) {
  const { i18n } = useTranslation()
  const pointName = usePointName()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const balances = (props.balances ?? [])
    .filter(
      (balance) =>
        balance.available_points !== '0' || balance.frozen_points !== '0'
    )
    .sort((a, b) => {
      const aGeneral = a.code === 'GENERAL' ? 0 : 1
      const bGeneral = b.code === 'GENERAL' ? 0 : 1
      if (aGeneral !== bGeneral) return aGeneral - bGeneral
      return a.code.localeCompare(b.code)
    })
  if (balances.length === 0) return <span>—</span>

  const format = (value: string) => formatNumber(BigInt(value), locale)

  return (
    <div className='grid min-w-0 gap-1 text-sm tabular-nums'>
      {balances.map((balance) => (
        <div
          key={balance.code}
          className='min-w-0 break-words whitespace-normal'
        >
          {pointName(balance)}：
          <span className='text-green-600 dark:text-green-400'>
            {format(balance.available_points)}
          </span>{' '}
          /{' '}
          <span className='text-orange-600 dark:text-orange-400'>
            {format(balance.frozen_points)}
          </span>
        </div>
      ))}
    </div>
  )
}

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

import { QuotaDetailsPopover } from '@/components/quota-details-popover'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { UserPointBalance } from '../types'

type UserPointsCellProps = {
  balances?: UserPointBalance[]
}

export function UserPointsCell(props: UserPointsCellProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const balances = (props.balances ?? []).filter(
    (balance) =>
      balance.available_points !== '0' || balance.frozen_points !== '0'
  )
  if (balances.length === 0) return <span>—</span>

  const format = (value: string) => formatNumber(BigInt(value), locale)
  const name = (balance: UserPointBalance) => {
    if (balance.code === 'GENERAL') return t('General points')
    if (balance.code === 'GPT') return 'GPT'
    return balance.name || balance.code
  }
  const details = (balance: UserPointBalance) => [
    {
      label: `${balance.name || balance.code} (${balance.code}) · ${t('Available points')}`,
      value: format(balance.available_points),
    },
    {
      label: `${balance.name || balance.code} (${balance.code}) · ${t('Frozen points')}`,
      value: format(balance.frozen_points),
    },
  ]

  return (
    <div className='grid min-w-0 gap-1 text-sm tabular-nums'>
      {balances.slice(0, 2).map((balance) => (
        <QuotaDetailsPopover
          key={balance.code}
          title={t('Points details')}
          triggerLabel={`${balance.name || balance.code} (${balance.code}) · ${t('Available points')} ${format(balance.available_points)}; ${t('Frozen points')} ${format(balance.frozen_points)}`}
          details={details(balance)}
        >
          <span className='grid w-full min-w-0 gap-0.5'>
            <span className='flex min-w-0 items-baseline gap-2'>
              <span className='text-muted-foreground max-w-24 shrink-0 truncate text-xs'>
                {name(balance)}
              </span>
              <span className='min-w-0 break-all whitespace-normal'>
                {format(balance.available_points)}
              </span>
            </span>
            {balance.frozen_points !== '0' && (
              <span
                data-table-text='secondary'
                className='text-muted-foreground text-xs break-words whitespace-normal'
              >
                {t('Frozen points')} {format(balance.frozen_points)}
              </span>
            )}
          </span>
        </QuotaDetailsPopover>
      ))}
      {balances.length > 2 && (
        <QuotaDetailsPopover
          title={t('Points details')}
          triggerLabel={t('More point types', { count: balances.length - 2 })}
          details={balances.flatMap(details)}
          triggerClassName='text-muted-foreground text-xs'
        >
          {t('More point types', { count: balances.length - 2 })}
        </QuotaDetailsPopover>
      )}
    </div>
  )
}

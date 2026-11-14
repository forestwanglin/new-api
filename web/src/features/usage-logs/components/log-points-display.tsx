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

import { pointBillingSchema } from '../data/schema'

/** Display committed event contributions; task summaries use the same safe DTO. */
export function LogPointsDisplay(props: { billing?: unknown }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const parsed = pointBillingSchema.safeParse(props.billing)
  if (!parsed.success) return <span className='text-muted-foreground'>—</span>
  const billing = parsed.data
  if (billing.status === 'pending') {
    return (
      <span className='text-muted-foreground text-xs'>
        {t('Points settlement pending')}
      </span>
    )
  }
  if (billing.status === 'error') {
    return (
      <span className='text-destructive text-xs'>
        {t('Points settlement failed')}
      </span>
    )
  }
  if (!billing.items.length) return <span className='tabular-nums'>0</span>

  const details = billing.items.map((item) => ({
    label: `${item.name || item.code} (${item.code})`,
    value: formatNumber(BigInt(item.points), locale),
  }))
  return (
    <div className='grid max-w-72 min-w-0 gap-1 text-xs tabular-nums'>
      {billing.items.slice(0, 2).map((item) => (
        <div
          key={item.point_type_id}
          className='flex min-w-0 flex-wrap items-baseline gap-x-2'
        >
          <span className='text-muted-foreground min-w-0 [overflow-wrap:anywhere]'>
            {item.name || item.code}
          </span>
          <span className='min-w-0 [overflow-wrap:anywhere]'>
            {formatNumber(BigInt(item.points), locale)}
          </span>
        </div>
      ))}
      {billing.items.length > 2 && (
        <QuotaDetailsPopover
          title={t('Consumed points')}
          triggerLabel={t('More point types', {
            count: billing.items.length - 2,
          })}
          details={details}
          triggerClassName='text-muted-foreground text-xs'
        >
          {t('More point types', { count: billing.items.length - 2 })}
        </QuotaDetailsPopover>
      )}
    </div>
  )
}

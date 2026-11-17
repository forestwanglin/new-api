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
import { Progress } from '@/components/ui/progress'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { API_KEY_STATUS } from '../constants'
import type { ApiKey } from '../types'

type ApiKeyQuotaCellProps = {
  apiKey: ApiKey
  now: number
  variant?: 'table' | 'card'
}

export function ApiKeyQuotaCell(props: ApiKeyQuotaCellProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const enabled = props.apiKey.point_limit_enabled === true
  const limit = BigInt(props.apiKey.point_limit || '0')
  const used = BigInt(props.apiKey.used_points || '0')
  const limited = enabled && limit > 0n
  const remaining = limit > used ? limit - used : 0n
  const percentage = limited ? Number((remaining * 1000n) / limit) / 10 : 0
  const formattedUsed = formatNumber(used, locale)
  const formattedLimit = formatNumber(limit, locale)
  const formattedRemaining = formatNumber(remaining, locale)
  const formattedPercentage = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  }).format(percentage)
  const isInactive =
    props.apiKey.status !== API_KEY_STATUS.ENABLED ||
    (limited && remaining <= 0n) ||
    (props.apiKey.expired_time !== -1 &&
      props.apiKey.expired_time * 1000 <= props.now)
  let progressColor = 'text-emerald-500'
  if (isInactive) progressColor = 'text-muted-foreground/60'
  else if (percentage <= 10) progressColor = 'text-rose-500'
  else if (percentage <= 30) progressColor = 'text-amber-500'
  let configured = t('Unlimited')
  if (!enabled) configured = t('Not set (legacy money limit retained)')
  else if (limited) configured = formattedLimit
  const triggerLabel = `${t('Point limit')} ${configured}; ${t('Used points')} ${formattedUsed}`

  const details = []
  details.push({ label: t('Point limit'), value: configured })
  details.push({ label: t('Used points'), value: formattedUsed })
  if (limited) {
    details.push({ label: t('Remaining points'), value: formattedRemaining })
    details.push({
      label: t('Remaining percentage'),
      value: `${formattedPercentage}%`,
    })
  }

  return (
    <QuotaDetailsPopover
      title={t('Point limit')}
      triggerLabel={triggerLabel}
      details={details}
      description={
        !enabled
          ? t(
              'Set a point limit when editing this key to replace its legacy money limit.'
            )
          : t(
              'Point usage is cumulative; editing the limit does not reset used points.'
            )
      }
      className={
        props.variant === 'card' ? 'space-y-2.5' : 'max-w-45 space-y-1.5'
      }
      triggerClassName={props.variant === 'card' ? 'py-0' : undefined}
      afterTrigger={
        limited && (
          <Progress
            value={percentage}
            aria-label={t('Remaining percentage')}
            className={cn(
              'w-full [&_[data-slot=progress-indicator]]:bg-current',
              progressColor
            )}
          />
        )
      }
    >
      <span
        data-slot='api-key-quota-values'
        className={cn(
          'grid w-full min-w-0 items-baseline gap-x-2 gap-y-1 text-sm',
          props.variant === 'card'
            ? 'grid-cols-[auto_minmax(0,1fr)]'
            : 'grid-cols-2'
        )}
      >
        {props.variant === 'card' && (
          <span className='text-muted-foreground'>{t('Point limit')}</span>
        )}
        <span
          className={cn(
            'min-w-0 truncate',
            props.variant === 'card'
              ? 'text-right text-sm leading-5 font-normal'
              : 'text-left font-medium',
            enabled && 'tabular-nums',
            remaining === 0n && limited && 'text-muted-foreground'
          )}
        >
          {configured}
        </span>
        {props.variant === 'card' && (
          <span className='text-muted-foreground'>{t('Used points')}</span>
        )}
        <span
          className={cn(
            'text-muted-foreground min-w-0 truncate text-right tabular-nums',
            props.variant === 'card' && 'text-sm leading-5 font-normal'
          )}
        >
          {formattedUsed}
        </span>
      </span>
    </QuotaDetailsPopover>
  )
}

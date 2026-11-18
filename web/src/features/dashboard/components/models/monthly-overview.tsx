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
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Calendar,
  Coins,
  Cpu,
  Gem,
  KeyRound,
  type LucideIcon,
} from 'lucide-react'

import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { getMonthlySummary } from '@/features/dashboard/api'
import type { MonthlySummary } from '@/features/dashboard/types'
import { toIntlLocale } from '@/i18n/languages'
import dayjs from '@/lib/dayjs'
import { formatCompactNumber, formatNumber, formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

interface MonthlyOverviewProps {
  isRoot: boolean
}

const MAX_INLINE_STAT_CHARS = 12

// 自然月区间（秒）：本月 1 日 00:00 → 现在。
function getMonthlyRange() {
  return {
    start_timestamp: Math.floor(dayjs().startOf('month').valueOf() / 1000),
    end_timestamp: Math.floor(Date.now() / 1000),
  }
}

function formatStatValue(value: number, locale: Intl.LocalesArgument) {
  const fullValue = formatNumber(value, locale)
  const displayValue =
    fullValue.length > MAX_INLINE_STAT_CHARS
      ? formatCompactNumber(value, locale)
      : fullValue
  return { displayValue, fullValue }
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0%'
  return `${((numerator / denominator) * 100).toFixed(1)}%`
}

interface CardSpec {
  key: string
  title: string
  icon: LucideIcon
  iconTone: IconBadgeTone
  value: ReactNode
  valueTitle?: string
  description: string
}

export function MonthlyOverview(props: MonthlyOverviewProps) {
  const { i18n, t } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { isRoot } = props

  const [summary, setSummary] = useState<MonthlySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [range, setRange] = useState(getMonthlyRange)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const nextRange = getMonthlyRange()
      const res = await getMonthlySummary(nextRange, isRoot)
      setRange(nextRange)
      setSummary(res?.data ?? null)
    } catch {
      setSummary(null)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [isRoot])

  // 挂载拉取；轻量定时器检测跨月；页面恢复可见时重拉。
  useEffect(() => {
    void load()
    const monthKey = () => dayjs().format('YYYY-MM')
    let currentMonth = monthKey()
    const timer = setInterval(() => {
      const next = monthKey()
      if (next !== currentMonth) {
        currentMonth = next
        void load()
      }
    }, 30_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
        new Date(range.start_timestamp * 1000)
      ),
    [locale, range.start_timestamp]
  )

  const quota = summary?.quota ?? 0
  const points = summary?.points ?? 0
  const totalCalls = summary?.total_calls ?? 0
  const topModel = summary?.top_model ?? null
  const topToken = summary?.top_token ?? null

  const pointsStat = formatStatValue(points, locale)

  const spendValue = () => (error ? '--' : formatQuota(quota))
  const spendDescription = () => {
    if (error) return ''
    return `${monthLabel} · ${t('{{count}} requests', {
      count: formatNumber(totalCalls, locale),
    })}`
  }

  const pointsValue = () => {
    if (error) return '--'
    return (
      <>
        {pointsStat.displayValue}
        <span className='ml-1 text-sm font-normal text-muted-foreground'>
          {t('points')}
        </span>
      </>
    )
  }
  const pointsDescription = () => (error ? '' : monthLabel)

  const modelValue = () => {
    if (error) return '--'
    if (!topModel) return t('No data')
    return topModel.model_name
  }
  const modelDescription = () => {
    if (error) return ''
    if (!topModel) return t('No calls this month yet')
    return t('{{count}} calls · {{percent}} of calls', {
      count: formatNumber(topModel.count, locale),
      percent: formatPercent(topModel.count, totalCalls),
    })
  }

  const tokenValue = () => {
    if (error) return '--'
    if (!topToken) return t('No data')
    return topToken.token_name || t('Deleted key')
  }
  const tokenDescription = () => {
    if (error) return ''
    if (!topToken) return t('No consumption this month yet')
    return t('{{points}} points · {{percent}} of spend', {
      points: formatNumber(topToken.points, locale),
      percent: formatPercent(topToken.points, points),
    })
  }

  const cards: CardSpec[] = [
    {
      key: 'spend',
      title: t("This Month's Spend"),
      icon: Coins,
      iconTone: 'success',
      value: spendValue(),
      valueTitle: error ? undefined : formatQuota(quota),
      description: spendDescription(),
    },
    {
      key: 'points',
      title: t("This Month's Points"),
      icon: Gem,
      iconTone: 'chart-4',
      value: pointsValue(),
      valueTitle: error ? undefined : pointsStat.fullValue,
      description: pointsDescription(),
    },
    {
      key: 'model',
      title: t('Most Used Model'),
      icon: Cpu,
      iconTone: 'info',
      value: modelValue(),
      valueTitle: error ? undefined : topModel?.model_name,
      description: modelDescription(),
    },
    {
      key: 'token',
      title: t('Most Expensive Key'),
      icon: KeyRound,
      iconTone: 'warning',
      value: tokenValue(),
      valueTitle: error ? undefined : tokenValue(),
      description: tokenDescription(),
    },
  ]

  return (
    <div className='general-card overflow-hidden rounded-lg border'>
      <div className='flex items-center gap-2 border-b px-4 py-3 sm:px-5'>
        <IconBadge tone='neutral' size='sm'>
          <Calendar />
        </IconBadge>
        <div className='min-w-0'>
          <div className='text-sm font-semibold'>
            {t('This Month at a Glance')}
          </div>
          <div className='text-muted-foreground truncate text-xs'>
            {t(
              'Statistics by calendar month; the charts below still use the selected range.'
            )}
          </div>
        </div>
      </div>
      <div className='grid grid-cols-2 gap-3 p-4 sm:p-5 lg:grid-cols-4'>
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <div
              key={card.key}
              role='group'
              aria-label={card.title}
              aria-busy={loading}
              className='min-w-0 rounded-xl border bg-muted/40 p-4'
            >
              <div className='flex min-w-0 items-center gap-2'>
                <IconBadge tone={card.iconTone} size='sm'>
                  <Icon />
                </IconBadge>
                <span
                  className='text-muted-foreground truncate text-xs font-medium'
                  title={card.title}
                >
                  {card.title}
                </span>
              </div>
              {loading ? (
                <div className='mt-3 space-y-1.5'>
                  <Skeleton className='h-6 w-24' />
                  <Skeleton className='h-3.5 w-32' />
                </div>
              ) : (
                <>
                  <div
                    className={cn(
                      'text-foreground mt-3 max-w-full truncate font-mono text-xl font-bold tracking-tight tabular-nums sm:text-2xl',
                      !card.value && 'text-muted-foreground'
                    )}
                    title={card.valueTitle}
                  >
                    {card.value}
                  </div>
                  <div
                    className='text-muted-foreground mt-1 truncate text-xs'
                    title={card.description}
                  >
                    {card.description}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

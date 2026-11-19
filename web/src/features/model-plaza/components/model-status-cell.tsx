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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  formatLatency,
  formatThroughput,
  getSuccessRateDotClass,
} from '@/features/performance-metrics/lib/format'
import type { PerfModelSummary } from '@/features/performance-metrics/types'
import { cn } from '@/lib/utils'

const STATUS_SAMPLE_LIMIT = 24

export function ModelStatusCell(props: { perf?: PerfModelSummary }) {
  const { t } = useTranslation()
  const successRate = props.perf?.success_rate
  const hasSuccessRate =
    successRate != null &&
    Number.isFinite(successRate) &&
    successRate >= 0 &&
    successRate <= 100
  const statusSamples = useMemo(
    () =>
      (props.perf?.recent_success_series ?? [])
        .filter(
          (point) =>
            Number.isFinite(point.ts) &&
            Number.isFinite(point.success_rate) &&
            point.success_rate >= 0 &&
            point.success_rate <= 100
        )
        .sort((a, b) => a.ts - b.ts)
        .slice(-STATUS_SAMPLE_LIMIT),
    [props.perf?.recent_success_series]
  )

  if (!hasSuccessRate) {
    return (
      <span
        aria-label={t('No performance data available')}
        className='text-muted-foreground text-sm'
      >
        —
      </span>
    )
  }

  const latency = formatLatency(props.perf?.avg_latency_ms ?? 0)
  const throughput = formatThroughput(props.perf?.avg_tps ?? 0).replace(
    ' t/s',
    't/s'
  )
  const detail = [
    latency === '—' ? null : latency,
    throughput === '—' ? null : throughput,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className='flex min-w-0 flex-col gap-1'>
      <div
        title={t(
          'Success rate excludes business rejections and includes the current partial hour.'
        )}
        className='flex items-center gap-1.5'
      >
        <span
          aria-hidden
          className={cn(
            'size-2 shrink-0 rounded-full',
            getSuccessRateDotClass(successRate)
          )}
        />
        <span className='font-mono text-sm font-semibold tabular-nums'>
          {successRate.toFixed(2)}%
        </span>
      </div>
      {statusSamples.length > 0 && (
        <span className='flex h-2.5 items-center gap-px' aria-hidden>
          {statusSamples.map((sample) => (
            <span
              key={sample.ts}
              className={cn(
                'h-full w-[3px] shrink-0 rounded-xs',
                getSuccessRateDotClass(sample.success_rate)
              )}
            />
          ))}
        </span>
      )}
      {detail && (
        <span className='text-muted-foreground font-mono text-xs whitespace-nowrap'>
          {detail}
        </span>
      )}
    </div>
  )
}

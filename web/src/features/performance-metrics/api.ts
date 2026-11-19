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
import { api } from '@/lib/api'

import type {
  PerformanceMetricsData,
  PerfModelSummary,
  PerfSummaryAllData,
  SuccessRatePoint,
} from './types'

// Keep in sync with perfmetrics.MaxRecentModels in the backend. A model page
// can request more names than one summary call accepts, so callers use the
// batching helper below instead of passing an unbounded list.
export const PERF_SUMMARY_MODEL_BATCH_SIZE = 50

export async function getPerfMetricsSummary(
  hours = 24,
  recentModels?: string[]
): Promise<PerfSummaryAllData> {
  const res = await api.get<PerfSummaryAllData>('/api/perf-metrics/summary', {
    params: { hours, recent_model: recentModels },
    paramsSerializer: { indexes: null },
  })
  return res.data
}

/**
 * Summaries are capped by the backend per request. Split the lookup into
 * batches of {@link PERF_SUMMARY_MODEL_BATCH_SIZE} and merge the payloads so
 * callers can pass a full table page.
 */
export async function getPerfMetricsSummaryBatched(
  modelNames: string[],
  hours = 24
): Promise<PerfSummaryAllData> {
  const names = [...new Set(modelNames.filter((name) => name.trim()))]
  if (names.length === 0) {
    return { success: true, data: { models: [], recent_success_series: {} } }
  }

  const batches: string[][] = []
  for (
    let index = 0;
    index < names.length;
    index += PERF_SUMMARY_MODEL_BATCH_SIZE
  ) {
    batches.push(names.slice(index, index + PERF_SUMMARY_MODEL_BATCH_SIZE))
  }

  const responses = await Promise.all(
    batches.map((batch) => getPerfMetricsSummary(hours, batch))
  )
  const models: PerfModelSummary[] = []
  const recentSuccessSeries: Record<string, SuccessRatePoint[]> = {}
  for (const response of responses) {
    models.push(...(response.data?.models ?? []))
    Object.assign(
      recentSuccessSeries,
      response.data?.recent_success_series ?? {}
    )
  }

  const first = responses[0]
  return {
    success: responses.every((response) => response.success !== false),
    data: {
      summary: first.data?.summary,
      window_start: first.data?.window_start,
      window_end: first.data?.window_end,
      models,
      recent_success_series: recentSuccessSeries,
    },
  }
}

export async function getPerfMetrics(
  modelName: string,
  hours = 24
): Promise<PerformanceMetricsData> {
  const res = await api.get<PerformanceMetricsData>('/api/perf-metrics', {
    params: {
      model: modelName,
      hours,
    },
  })
  return res.data
}

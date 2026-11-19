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
import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  getPerfMetricsSummaryBatched,
  PERF_SUMMARY_MODEL_BATCH_SIZE,
} from '../api'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/lib/api', () => ({
  api: { get },
}))

beforeEach(() => {
  get.mockReset()
})

describe('getPerfMetricsSummaryBatched', () => {
  test('splits names over the backend limit into separate summary requests', async () => {
    const names = Array.from(
      { length: PERF_SUMMARY_MODEL_BATCH_SIZE + 1 },
      (_, index) => `model-${index}`
    )
    get.mockImplementation(async (_url, config) => {
      const batch = config.params.recent_model as string[]
      return {
        data: {
          success: true,
          data: {
            window_start: 1,
            window_end: 2,
            models: batch.map((name) => ({
              model_name: name,
              avg_latency_ms: 100,
              success_rate: 100,
              avg_tps: 10,
            })),
            recent_success_series: Object.fromEntries(
              batch.map((name) => [name, [{ ts: 1, success_rate: 100 }]])
            ),
          },
        },
      }
    })

    const summary = await getPerfMetricsSummaryBatched(names, 24)

    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenNthCalledWith(1, '/api/perf-metrics/summary', {
      params: {
        hours: 24,
        recent_model: names.slice(0, PERF_SUMMARY_MODEL_BATCH_SIZE),
      },
      paramsSerializer: { indexes: null },
    })
    expect(get).toHaveBeenNthCalledWith(2, '/api/perf-metrics/summary', {
      params: {
        hours: 24,
        recent_model: names.slice(PERF_SUMMARY_MODEL_BATCH_SIZE),
      },
      paramsSerializer: { indexes: null },
    })
    expect(summary.data.models).toHaveLength(names.length)
    expect(summary.data.window_start).toBe(1)
    expect(summary.data.window_end).toBe(2)
    expect(Object.keys(summary.data.recent_success_series ?? {})).toHaveLength(
      names.length
    )
  })

  test('ignores duplicate and blank names and skips the request for an empty list', async () => {
    await expect(getPerfMetricsSummaryBatched([], 24)).resolves.toEqual({
      success: true,
      data: { models: [], recent_success_series: {} },
    })
    expect(get).not.toHaveBeenCalled()

    get.mockResolvedValue({
      data: {
        success: true,
        data: { models: [], recent_success_series: {} },
      },
    })
    await getPerfMetricsSummaryBatched(['model-a', 'model-a', '  '], 24)
    expect(get).toHaveBeenCalledWith('/api/perf-metrics/summary', {
      params: { hours: 24, recent_model: ['model-a'] },
      paramsSerializer: { indexes: null },
    })
  })

  test('marks the merged summary as failed when any batch fails', async () => {
    get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          models: [
            {
              model_name: 'model-a',
              avg_latency_ms: 100,
              success_rate: 100,
              avg_tps: 10,
            },
          ],
          recent_success_series: {},
        },
      },
    })
    get.mockResolvedValueOnce({
      data: { success: false, message: 'batch failed' },
    })

    const summary = await getPerfMetricsSummaryBatched(
      Array.from(
        { length: PERF_SUMMARY_MODEL_BATCH_SIZE + 1 },
        (_, index) => `model-${index}`
      ),
      24
    )

    expect(summary.success).toBe(false)
    expect(summary.data.models).toHaveLength(1)
  })
})

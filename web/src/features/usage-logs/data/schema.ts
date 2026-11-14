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
/**
 * Zod schemas for common logs
 * This file should only contain Zod schemas and types inferred from them
 */
import { z } from 'zod'

const pointInteger = z
  .string()
  .max(20)
  .regex(/^-?(0|[1-9]\d*)$/)

export const pointBillingSchema = z
  .object({
    version: z.literal(1),
    call_id: z.string(),
    event_id: z.string(),
    status: z.enum(['committed', 'pending', 'error']),
    total_points: pointInteger,
    items: z.array(
      z.object({
        point_type_id: z.string().regex(/^[1-9]\d*$/),
        code: z.string(),
        name: z.string(),
        points: pointInteger,
      })
    ),
  })
  .refine((value) => {
    if (value.status !== 'committed') return true
    if (
      !pointInteger.safeParse(value.total_points).success ||
      value.items.some((item) => !pointInteger.safeParse(item.points).success)
    ) {
      return false
    }
    const ids = value.items.map((item) => item.point_type_id)
    return (
      new Set(ids).size === ids.length &&
      value.items.reduce((total, item) => total + BigInt(item.points), 0n) ===
        BigInt(value.total_points)
    )
  })

export type PointBilling = z.infer<typeof pointBillingSchema>

// Usage log schema
export const usageLogSchema = z.object({
  id: z.number(),
  user_id: z.number(),
  created_at: z.number(),
  type: z.number(),
  content: z.string(),
  username: z.string().default(''),
  token_name: z.string().default(''),
  model_name: z.string().default(''),
  quota: z.number().default(0),
  prompt_tokens: z.number().default(0),
  completion_tokens: z.number().default(0),
  use_time: z.number().default(0),
  is_stream: z.boolean().default(false),
  channel: z.number().default(0),
  channel_name: z.string().nullish().default(''),
  token_id: z.number().default(0),
  group: z.string().default(''),
  ip: z.string().default(''),
  other: z.string().default(''),
  request_id: z.string().default(''),
  upstream_request_id: z.string().default(''),
})

export type UsageLog = z.infer<typeof usageLogSchema>

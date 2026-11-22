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
import { z } from 'zod'

export const pointRuleSchema = z.object({
  match_type: z.enum(['EXACT', 'PATTERN']),
  match_value: z
    .string()
    .refine(
      (value) =>
        [...value].length >= 1 &&
        [...value].length <= 255 &&
        value.trim() === value &&
        !/\p{Cc}/u.test(value),
      'Use 1–255 characters without surrounding whitespace or control characters.'
    ),
  enabled: z.boolean(),
})

export type PointRuleFormValues = z.infer<typeof pointRuleSchema>

export const pointNameSchema = z
  .string()
  .refine(
    (value) =>
      [...value].length >= 1 &&
      [...value].length <= 64 &&
      value.trim() === value &&
      !/\p{Cc}/u.test(value),
    'Use 1–64 characters without surrounding whitespace or control characters.'
  )

const pointConditionSchema = z.discriminatedUnion('kind', [
  pointRuleSchema.extend({ kind: z.literal('MODEL') }).strict(),
  z
    .object({
      kind: z.literal('CHANNEL'),
      channel_id: z
        .string()
        .regex(/^[1-9]\d*$/)
        .refine(
          (value) =>
            /^[1-9]\d*$/.test(value) && BigInt(value) <= 9223372036854775807n
        ),
      enabled: z.boolean(),
    })
    .strict(),
])

export const pointPolicySchema = z
  .object({
    version: z.literal(1),
    operator: z.enum(['OR', 'AND']),
    groups: z
      .array(
        z
          .object({
            operator: z.enum(['OR', 'AND']),
            enabled: z.boolean(),
            conditions: z.array(pointConditionSchema).max(64),
          })
          .strict()
          .refine(
            (group) =>
              !group.enabled ||
              group.conditions.some((condition) => condition.enabled),
            'An enabled group needs an enabled condition.'
          )
      )
      .max(32),
  })
  .strict()
  .refine(
    (policy) =>
      policy.groups.reduce(
        (count, group) => count + group.conditions.length,
        0
      ) <= 512,
    'Use at most 512 conditions.'
  )

export type PointPolicyFormValues = z.infer<typeof pointPolicySchema>

export const pointCodeSchema = z
  .string()
  .regex(
    /^[A-Z][A-Z0-9_]{0,31}$/,
    'Point type code must start with an uppercase letter and contain only uppercase letters, digits or underscores (1 to 32 characters)'
  )

export const pointPrioritySchema = z
  .string()
  .refine(
    (value) =>
      /^-?\d+$/.test(value) &&
      Number(value) >= -2147483648 &&
      Number(value) <= 2147483647,
    'Consumption priority must be a 32-bit integer'
  )

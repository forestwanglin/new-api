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

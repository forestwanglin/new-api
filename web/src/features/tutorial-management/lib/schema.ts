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

const key = z
  .string()
  .regex(
    /^[a-z0-9_-]{1,64}$/,
    'Use 1–64 lowercase letters, numbers, hyphens or underscores.'
  )
const title = z
  .string()
  .trim()
  .min(1, 'Enter a title.')
  .refine(
    (value) => [...value].length <= 128,
    'Title must be at most 128 characters.'
  )
const sort = z.number().int().min(0).max(2147483647)
export const groupSchema = z.object({
  group_key: key,
  title,
  sort_order: sort,
  enabled: z.boolean(),
})
export const chapterSchema = z.object({
  group_id: z
    .string()
    .regex(/^[1-9][0-9]*$/, 'Select a tutorial group.')
    .refine(
      (value) =>
        /^[1-9][0-9]*$/.test(value) && BigInt(value) <= 9223372036854775807n,
      'Invalid tutorial group.'
    ),
  anchor: key,
  title,
  sort_order: sort,
  enabled: z.boolean(),
  content_markdown: z
    .string()
    .refine((value) => value.trim().length > 0, 'Enter Markdown content.')
    .refine(
      (value) => new TextEncoder().encode(value).byteLength <= 65536,
      'Markdown must be at most 64 KiB.'
    ),
})

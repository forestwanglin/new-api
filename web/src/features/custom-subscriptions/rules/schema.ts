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

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit HEX color')
const style = z
  .object({
    fontWeight: z.union([z.literal(400), z.literal(700)]).optional(),
    color: color.optional(),
    backgroundColor: color.optional(),
  })
  .strict()
export const ruleContentSchema = z
  .object({
    blocks: z
      .array(
        z
          .object({
            type: z.literal('paragraph'),
            children: z
              .array(
                z.object({ text: z.string(), style: style.optional() }).strict()
              )
              .min(1)
              .max(50),
          })
          .strict()
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((content, context) => {
    const text = content.blocks
      .flatMap((block) => block.children.map((part) => part.text))
      .join('')
    if (!text.trim()) {
      context.addIssue({ code: 'custom', message: 'Rule content is required' })
    }
    if ([...text].length > 10000) {
      context.addIssue({
        code: 'custom',
        message: 'Rule content must not exceed 10000 characters',
      })
    }
  })
export const ruleInputSchema = z
  .object({
    plan_id: z
      .string()
      .refine(
        (value) =>
          /^[1-9][0-9]*$/.test(value) && BigInt(value) <= 9223372036854775807n,
        'Select a plan'
      )
      .nullable(),
    rule_key: z
      .string()
      .min(1)
      .max(64)
      .regex(
        /^[a-z0-9_-]+$/,
        'Use lowercase letters, numbers, underscores or hyphens'
      ),
    title: z
      .string()
      .refine(
        (value) =>
          value.trim().length > 0 &&
          [...value].length <= 128 &&
          ![...value].some(
            (character) =>
              character.charCodeAt(0) < 32 ||
              (character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159)
          ),
        'Rule title is required and must not exceed 128 characters'
      ),
    content: ruleContentSchema,
    enabled: z.boolean(),
    sort_order: z.number().int().min(0).max(2147483647),
  })
  .strict()
  .superRefine((value, context) => {
    if (new TextEncoder().encode(JSON.stringify(value)).length > 64000) {
      context.addIssue({
        code: 'custom',
        message: 'Rule content is too large',
        path: ['content'],
      })
    }
  })
export const defaultRuleInput: z.infer<typeof ruleInputSchema> = {
  plan_id: null,
  rule_key: '',
  title: '',
  content: { blocks: [{ type: 'paragraph', children: [{ text: '' }] }] },
  enabled: true,
  sort_order: 0,
}

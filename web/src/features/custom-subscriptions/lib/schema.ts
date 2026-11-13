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

import type {
  CustomSubscriptionPlan,
  PlanInput,
  PointTypeOption,
} from '../types'

const MAX_INT64 = 9223372036854775807n
const integer = /^(0|[1-9][0-9]*)$/
const invalid = 'Invalid custom subscription plan fields'

function isInteger(value: string, positive = false, max = MAX_INT64): boolean {
  return (
    integer.test(value) &&
    BigInt(value) <= max &&
    (!positive || BigInt(value) > 0n)
  )
}

export function yuanToMinor(value: string): string {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value)) throw new Error(invalid)
  const [whole, fraction = ''] = value.split('.')
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (minor > MAX_INT64) throw new Error(invalid)
  return minor.toString()
}

export function minorToYuan(value: string): string {
  const minor = BigInt(value)
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`
}

export function autoBonusPoints(
  paid: string,
  bonus: string,
  bps: number
): string {
  return (((BigInt(paid) + BigInt(bonus)) * BigInt(bps)) / 10000n).toString()
}

const baseSchema = z.object({
  code: z.string(),
  title: z.string(),
  subtitle: z.string(),
  tier_code: z.string(),
  tier_rank: z.string(),
  priority: z.string(),
  billing_cycle: z.enum(['month', 'year']),
  price_yuan: z.string(),
  paid_points: z.string(),
  paid_point_type_id: z.string(),
  bonus_points: z.string(),
  bonus_point_type_id: z.string(),
  auto_renew_enabled: z.boolean(),
  auto_renew_bonus_bps: z.string(),
  auto_bonus_point_type_id: z.string(),
  benefits_text: z.string(),
  enabled: z.boolean(),
  sort_order: z.string(),
})
export type PlanFormValues = z.infer<typeof baseSchema>

export const defaultPlanValues: PlanFormValues = {
  code: '',
  title: '',
  subtitle: '',
  tier_code: '',
  tier_rank: '1',
  priority: '0',
  billing_cycle: 'month',
  price_yuan: '',
  paid_points: '',
  paid_point_type_id: '',
  bonus_points: '0',
  bonus_point_type_id: '',
  auto_renew_enabled: false,
  auto_renew_bonus_bps: '0',
  auto_bonus_point_type_id: '',
  benefits_text: '',
  enabled: true,
  sort_order: '0',
}

function validText(value: string, max: number, required = false): boolean {
  return (
    [...value].length <= max &&
    !/[\p{Cc}\p{Cs}]/u.test(value) &&
    (!required || value.trim().length > 0)
  )
}

export function createPlanSchema(types: PointTypeOption[]) {
  return baseSchema.superRefine((values, ctx) => {
    const issue = (path: keyof PlanFormValues, message = invalid) =>
      ctx.addIssue({ code: 'custom', path: [path], message })
    const typeExists = (id: string) =>
      isInteger(id, true) && types.some((type) => type.id === id)
    if (!/^[a-z0-9_-]{1,64}$/.test(values.code)) issue('code')
    if (!/^[a-z0-9_-]{1,32}$/.test(values.tier_code)) issue('tier_code')
    if (!validText(values.title, 128, true)) issue('title')
    if (!validText(values.subtitle, 255)) issue('subtitle')
    if (!isInteger(values.tier_rank, true, 2147483647n)) issue('tier_rank')
    if (!isInteger(values.priority, false, 2147483647n)) issue('priority')
    if (!isInteger(values.sort_order, false, 2147483647n)) issue('sort_order')
    try {
      if (yuanToMinor(values.price_yuan) === '0') issue('price_yuan')
    } catch {
      issue('price_yuan')
    }
    if (!typeExists(values.paid_point_type_id)) {
      issue('paid_point_type_id', 'Select an available point type')
    }
    const paidValid = isInteger(values.paid_points, true)
    const bonusValid = isInteger(values.bonus_points)
    const bpsValid = isInteger(values.auto_renew_bonus_bps, false, 10000n)
    if (!paidValid) issue('paid_points')
    if (!bonusValid) issue('bonus_points')
    if (!bpsValid) issue('auto_renew_bonus_bps')
    if (
      bonusValid &&
      BigInt(values.bonus_points) > 0n &&
      !typeExists(values.bonus_point_type_id)
    ) {
      issue('bonus_point_type_id', 'Select an available point type')
    }
    if (
      bpsValid &&
      BigInt(values.auto_renew_bonus_bps) > 0n &&
      !typeExists(values.auto_bonus_point_type_id)
    ) {
      issue('auto_bonus_point_type_id', 'Select an available point type')
    }
    if (paidValid && bonusValid && bpsValid) {
      const base = BigInt(values.paid_points) + BigInt(values.bonus_points)
      const bps = BigInt(values.auto_renew_bonus_bps)
      if (base + (base * bps) / 10000n > MAX_INT64) {
        issue('paid_points', 'Total points exceed the supported range')
      }
    }
    const benefits =
      values.benefits_text === '' ? [] : values.benefits_text.split('\n')
    if (
      benefits.length > 20 ||
      benefits.some((benefit) => !validText(benefit, 255, true))
    ) {
      issue('benefits_text')
    }
  })
}

export function toPlanInput(values: PlanFormValues): PlanInput {
  const bps = Number(values.auto_renew_bonus_bps)
  return {
    code: values.code,
    title: values.title,
    subtitle: values.subtitle,
    tier_code: values.tier_code,
    tier_rank: Number(values.tier_rank),
    priority: Number(values.priority),
    billing_cycle: values.billing_cycle,
    duration_months: values.billing_cycle === 'month' ? 1 : 12,
    currency: 'CNY',
    price_amount_minor: yuanToMinor(values.price_yuan),
    paid_points: values.paid_points,
    paid_point_type_id: values.paid_point_type_id,
    bonus_points: values.bonus_points,
    bonus_point_type_id:
      values.bonus_points === '0' ? null : values.bonus_point_type_id,
    auto_renew_enabled: values.auto_renew_enabled,
    auto_renew_bonus_bps: bps,
    auto_bonus_point_type_id:
      bps === 0 ? null : values.auto_bonus_point_type_id,
    benefits:
      values.benefits_text === '' ? [] : values.benefits_text.split('\n'),
    enabled: values.enabled,
    sort_order: Number(values.sort_order),
  }
}

export function planFormValues(plan: CustomSubscriptionPlan): PlanFormValues {
  return {
    code: plan.code,
    title: plan.title,
    subtitle: plan.subtitle,
    tier_code: plan.tier_code,
    tier_rank: String(plan.tier_rank),
    priority: String(plan.priority),
    billing_cycle: plan.billing_cycle,
    price_yuan: minorToYuan(plan.price_amount_minor),
    paid_points: plan.paid_points,
    paid_point_type_id: plan.paid_point_type_id,
    bonus_points: plan.bonus_points,
    bonus_point_type_id: plan.bonus_point_type_id ?? '',
    auto_renew_enabled: plan.auto_renew_enabled,
    auto_renew_bonus_bps: String(plan.auto_renew_bonus_bps),
    auto_bonus_point_type_id: plan.auto_bonus_point_type_id ?? '',
    benefits_text: plan.benefits.join('\n'),
    enabled: plan.enabled,
    sort_order: String(plan.sort_order),
  }
}

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

import { autoBonusPoints } from '@/features/custom-subscriptions/lib/schema'
import { formatNumber } from '@/lib/format'

const quantity = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n)
const pointType = z.object({ id: quantity, code: z.string(), name: z.string() })
export const publicPlanSchema = z
  .object({
    id: quantity,
    version: quantity,
    title: z.string(),
    subtitle: z.string(),
    billing_cycle: z.enum(['month', 'year']),
    duration_months: z.number().int().positive(),
    currency: z.literal('CNY'),
    price_amount_minor: quantity,
    paid_points: quantity,
    paid_point_type: pointType,
    bonus_points: quantity,
    bonus_point_type: pointType.nullable(),
    auto_renew_enabled: z.boolean(),
    auto_renew_bonus_bps: z.number().int().min(0).max(10000),
    auto_bonus_point_type: pointType.nullable(),
    benefits: z.array(z.string()),
  })
  .refine(
    (plan) =>
      (plan.bonus_points === '0' || plan.bonus_point_type !== null) &&
      (plan.auto_renew_bonus_bps === 0 || plan.auto_bonus_point_type !== null),
    'Missing configured point type'
  )
export type PublicSubscriptionPlan = z.infer<typeof publicPlanSchema>
export type Offer = {
  plan: PublicSubscriptionPlan
  yearly: boolean
  auto: boolean
}
export function offerId(offer: Offer): string {
  return offer.plan.id
}

// Sum only matching identities; distinct point currencies remain explicit.
export function offerPointAmounts(
  plan: PublicSubscriptionPlan,
  renewal = false
): { id: string; name: string; amount: bigint }[] {
  const amounts = new Map<
    string,
    { id: string; name: string; amount: bigint }
  >()
  const entries = [
    { type: plan.paid_point_type, value: plan.paid_points },
    { type: plan.bonus_point_type, value: plan.bonus_points },
  ]
  if (renewal) {
    entries.push({
      type: plan.auto_bonus_point_type,
      value: autoBonusPoints(
        plan.paid_points,
        plan.bonus_points,
        plan.auto_renew_bonus_bps
      ),
    })
  }
  for (const entry of entries) {
    if (!entry.type || entry.value === '0') continue
    const current = amounts.get(entry.type.id)
    amounts.set(entry.type.id, {
      id: entry.type.id,
      name: entry.type.name,
      amount: (current?.amount ?? 0n) + BigInt(entry.value),
    })
  }
  return [...amounts.values()]
}

export function formatOfferPoints(
  plan: PublicSubscriptionPlan,
  locale: string
): string {
  return offerPointAmounts(plan)
    .map((entry) => `${formatNumber(entry.amount, locale)} ${entry.name}`)
    .join(' + ')
}

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

import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { publicPlanSchema, type PublicSubscriptionPlan } from './plans'

export const publicPlanKey = ['subscription-plans', 'public'] as const
export async function getPublicPlans(): Promise<PublicSubscriptionPlan[]> {
  const response = await api.get<{
    success: boolean
    message?: string
    data: { items: unknown }
  }>('/api/custom_subscription/plans')
  return publicPlanSchema
    .array()
    .parse(requireServerSuccess(response.data).data.items)
}

const paymentMethodSchema = z.object({
  type: z.enum(['alipay', 'wxpay']),
  name: z.string(),
})
export async function getSubscriptionPaymentMethods() {
  const response = await api.get('/api/custom_subscription/payment_methods')
  return paymentMethodSchema
    .array()
    .parse(requireServerSuccess(response.data).data.items)
}
export interface SubscriptionCheckoutInput {
  plan_id: string
  plan_version: string
  payment_method: string
  request_id: string
}
export async function createSubscriptionOrder(
  input: SubscriptionCheckoutInput
) {
  const response = await api.post('/api/custom_subscription/orders', input)
  return z
    .union([
      z.object({
        trade_no: z.string().min(1),
        url: z
          .url()
          .refine((value) =>
            ['https:', 'http:'].includes(new URL(value).protocol)
          ),
        params: z.record(z.string(), z.string()),
      }),
      z.object({ trade_no: z.string().min(1), status: z.string() }),
    ])
    .parse(requireServerSuccess(response.data).data)
}
export async function getSubscriptionOrder(tradeNo: string) {
  const response = await api.get(
    `/api/custom_subscription/orders/${encodeURIComponent(tradeNo)}`
  )
  return z
    .object({
      trade_no: z.string(),
      status: z.string(),
      fulfillment_status: z.string(),
    })
    .parse(requireServerSuccess(response.data).data)
}

const decimalInteger = z.string().regex(/^-?(0|[1-9][0-9]*)$/)
const timestamp = z
  .string()
  .regex(/^[0-9]+$/)
  .refine((value) => BigInt(value) <= 8640000000000000n)
const subscriptionSchema = z.object({
  id: decimalInteger,
  plan_id: decimalInteger,
  plan_title: z.string(),
  status: z.enum(['active', 'paused', 'expired', 'cancelled']),
  priority: z.number().int(),
  billing_cycle: z.string(),
  remaining_duration_ms: z.string().regex(/^[0-9]+$/),
  purchased_at: timestamp,
  first_activated_at: timestamp.nullable(),
  active_since_at: timestamp.nullable(),
  active_until_at: timestamp.nullable(),
  ended_at: timestamp.nullable(),
})
const selfSchema = z.object({
  active_subscription_id: decimalInteger.nullable(),
  observed_at: timestamp,
  items: subscriptionSchema.array(),
})
export type CustomSubscription = z.infer<typeof subscriptionSchema>
export type CustomSubscriptionSelf = z.infer<typeof selfSchema>
export const customSubscriptionSelfKey = (userId: number | undefined) =>
  ['custom-subscription-self', userId] as const
export async function getCustomSubscriptionSelf(): Promise<CustomSubscriptionSelf> {
  const response = await api.get('/api/custom_subscription/self')
  return selfSchema.parse(requireServerSuccess(response.data).data)
}

const orderSchema = z.object({
  id: decimalInteger,
  plan_id: decimalInteger,
  plan_title: z.string(),
  trade_no: z.string(),
  billing_cycle: z.string(),
  currency: z.string(),
  amount_due_minor: decimalInteger,
  amount_paid_minor: decimalInteger,
  paid_points: decimalInteger,
  bonus_points: decimalInteger,
  auto_bonus_points: decimalInteger,
  payment_method: z.string(),
  status: z.string(),
  fulfillment_status: z.string(),
  created_at: timestamp,
  paid_at: timestamp.nullable(),
})
const ordersPageSchema = z.object({
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  items: orderSchema.array(),
})
export type CustomSubscriptionOrder = z.infer<typeof orderSchema>
export const customSubscriptionOrdersKey = (
  userId: number | undefined,
  page: number,
  pageSize: number
) => ['custom-subscription-orders', userId, page, pageSize] as const
export async function getCustomSubscriptionOrders(
  page: number,
  pageSize: number
) {
  const response = await api.get('/api/custom_subscription/orders', {
    params: { p: page, page_size: pageSize },
  })
  return ordersPageSchema.parse(requireServerSuccess(response.data).data)
}

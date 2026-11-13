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

export async function getCustomSubscriptionSelf() {
  const response = await api.get('/api/custom_subscription/self')
  return z
    .object({
      items: z.array(
        z.object({
          id: z.string(),
          plan_id: z.string(),
          status: z.enum(['active', 'paused', 'expired', 'cancelled']),
          priority: z.number().int(),
          remaining_duration_ms: z.string().regex(/^[0-9]+$/),
        })
      ),
    })
    .parse(requireServerSuccess(response.data).data).items
}

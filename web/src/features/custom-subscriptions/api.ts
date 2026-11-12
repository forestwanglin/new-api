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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type {
  CustomSubscriptionPlan,
  PlanFilters,
  PlanInput,
  PlanList,
} from './types'

type Response<T> = { success: boolean; message?: string; data: T }
const base = '/api/custom_subscription/admin/plans'
export const subscriptionKeys = {
  all: (viewer: string) => ['custom-subscriptions', viewer] as const,
  list: (viewer: string, filters: PlanFilters) =>
    ['custom-subscriptions', viewer, 'list', filters] as const,
  detail: (viewer: string, id: string) =>
    ['custom-subscriptions', viewer, 'detail', id] as const,
}
export async function listPlans(filters: PlanFilters): Promise<PlanList> {
  const response = await api.get<Response<PlanList>>(base, { params: filters })
  return requireServerSuccess(response.data).data
}
export async function getPlan(id: string): Promise<CustomSubscriptionPlan> {
  const response = await api.get<Response<CustomSubscriptionPlan>>(
    `${base}/${id}`
  )
  return requireServerSuccess(response.data).data
}
export async function savePlan(
  input: PlanInput,
  current?: { id: string; version: string }
): Promise<CustomSubscriptionPlan> {
  // Build an allowlisted configuration DTO; persisted/display fields never enter writes.
  const body: PlanInput = {
    code: input.code,
    title: input.title,
    subtitle: input.subtitle,
    tier_code: input.tier_code,
    tier_rank: input.tier_rank,
    billing_cycle: input.billing_cycle,
    duration_months: input.duration_months,
    currency: input.currency,
    price_amount_minor: input.price_amount_minor,
    paid_points: input.paid_points,
    paid_point_type_id: input.paid_point_type_id,
    bonus_points: input.bonus_points,
    bonus_point_type_id: input.bonus_point_type_id,
    auto_renew_enabled: input.auto_renew_enabled,
    auto_renew_bonus_bps: input.auto_renew_bonus_bps,
    auto_bonus_point_type_id: input.auto_bonus_point_type_id,
    benefits: input.benefits,
    enabled: input.enabled,
    sort_order: input.sort_order,
  }
  const response = current
    ? await api.put<Response<CustomSubscriptionPlan>>(`${base}/${current.id}`, {
        ...body,
        version: current.version,
      })
    : await api.post<Response<CustomSubscriptionPlan>>(base, body)
  return requireServerSuccess(response.data).data
}
export async function deletePlan(id: string): Promise<void> {
  const response = await api.delete<Response<null>>(`${base}/${id}`)
  requireServerSuccess(response.data)
}

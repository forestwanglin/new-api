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
export type PointTypeOption = { id: string; code: string; name: string }
export type PlanInput = {
  code: string
  title: string
  subtitle: string
  tier_code: string
  tier_rank: number
  billing_cycle: 'month' | 'year'
  duration_months: number
  currency: 'CNY'
  price_amount_minor: string
  paid_points: string
  paid_point_type_id: string
  bonus_points: string
  bonus_point_type_id: string | null
  auto_renew_enabled: boolean
  auto_renew_bonus_bps: number
  auto_bonus_point_type_id: string | null
  benefits: string[]
  enabled: boolean
  sort_order: number
}
export type CustomSubscriptionPlan = PlanInput & {
  id: string
  version: string
  created_at: number
  updated_at: number
  paid_point_type: PointTypeOption | null
  bonus_point_type: PointTypeOption | null
  auto_bonus_point_type: PointTypeOption | null
}
export type PlanFilters = {
  p: number
  page_size: number
  keyword?: string
  enabled?: 'true' | 'false'
  billing_cycle?: 'month' | 'year'
}
export type PlanList = {
  page: number
  page_size: number
  total: number
  items: CustomSubscriptionPlan[]
  point_types: PointTypeOption[]
}

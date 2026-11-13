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
import type { PublicRule, RuleFilters, RuleInput, RuleList, SubscriptionRule } from './types'

type Response<T> = { success: boolean; message?: string; data: T }
const base = '/api/custom_subscription/admin/rules'
export const ruleKeys = {
  all: (viewer: string) => ['custom-subscription-rules', viewer] as const,
  list: (viewer: string, filters: RuleFilters) => ['custom-subscription-rules', viewer, 'list', filters] as const,
  detail: (viewer: string, id: string) => ['custom-subscription-rules', viewer, 'detail', id] as const,
  public: ['subscription-rules', 'public'] as const,
}
export async function listRules(filters: RuleFilters): Promise<RuleList> {
  const response = await api.get<Response<RuleList>>(base, { params: filters })
  return requireServerSuccess(response.data).data
}
export async function getRule(id: string): Promise<SubscriptionRule> {
  const response = await api.get<Response<SubscriptionRule>>(`${base}/${id}`)
  return requireServerSuccess(response.data).data
}
export async function saveRule(input: RuleInput, current?: { id: string; version: string }): Promise<SubscriptionRule> {
  const body: RuleInput = { plan_id: input.plan_id, rule_key: input.rule_key, title: input.title, content: input.content, enabled: input.enabled, sort_order: input.sort_order }
  const response = current ? await api.put<Response<SubscriptionRule>>(`${base}/${current.id}`, { ...body, version: current.version }) : await api.post<Response<SubscriptionRule>>(base, body)
  return requireServerSuccess(response.data).data
}
export async function deleteRule(id: string): Promise<void> {
  const response = await api.delete<Response<null>>(`${base}/${id}`)
  requireServerSuccess(response.data)
}
export async function getPublicRules(): Promise<PublicRule[]> {
  const response = await api.get<Response<{ items: PublicRule[] }>>('/api/custom_subscription/rules')
  return requireServerSuccess(response.data).data.items
}

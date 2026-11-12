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

import type { PointModelRule, PointRuleInput, PointType } from './types'

type PointsResponse<T> = { success: boolean; message?: string; data: T }

export const pointsQueryKeys = {
  types: ['points', 'types'] as const,
  rules: (typeId: number) => ['points', 'types', typeId, 'rules'] as const,
}

export async function getPointTypes(): Promise<PointType[]> {
  const response =
    await api.get<PointsResponse<PointType[]>>('/api/points/types')
  return requireServerSuccess(response.data).data
}

export async function getPointRules(typeId: number): Promise<PointModelRule[]> {
  const response = await api.get<PointsResponse<PointModelRule[]>>(
    `/api/points/types/${typeId}/rules`
  )
  return requireServerSuccess(response.data).data
}

export async function savePointRule(
  typeId: number,
  values: PointRuleInput,
  ruleId?: number
): Promise<void> {
  const url = `/api/points/types/${typeId}/rules`
  // Send only editable fields, including explicit false.
  const body: PointRuleInput = {
    match_type: values.match_type,
    match_value: values.match_value,
    enabled: values.enabled,
  }
  const response =
    ruleId === undefined
      ? await api.post<PointsResponse<unknown>>(url, body)
      : await api.put<PointsResponse<unknown>>(`${url}/${ruleId}`, body)
  requireServerSuccess(response.data)
}

export async function deletePointRule(
  typeId: number,
  ruleId: number
): Promise<void> {
  const response = await api.delete<PointsResponse<unknown>>(
    `/api/points/types/${typeId}/rules/${ruleId}`
  )
  requireServerSuccess(response.data)
}

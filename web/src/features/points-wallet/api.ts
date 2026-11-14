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

import type { PublicRule } from '@/features/custom-subscriptions/rules/types'
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

const integer = z.string().regex(/^-?(0|[1-9][0-9]*)$/)
const walletSchema = z.object({
  balances: z.array(
    z.object({
      point_type_id: integer,
      code: z.string(),
      name: z.string(),
      available_points: integer,
      frozen_points: integer,
    })
  ),
  pending_gpt_points: integer.nullable(),
  source_summaries: z.array(
    z.object({
      point_type_id: integer,
      point_type_code: z.string(),
      point_type_name: z.string(),
      biz_type: z.string(),
      increased_points: integer,
      decreased_points: integer,
      net_points: integer,
    })
  ),
})
export type PointWallet = z.infer<typeof walletSchema>
export const pointsWalletKey = (userId: number | undefined) =>
  ['points-wallet', userId] as const
export async function getPointsWallet(): Promise<PointWallet> {
  const response = await api.get('/api/points/wallet/self')
  return walletSchema.parse(requireServerSuccess(response.data).data)
}
export async function getPointsWalletRules(): Promise<PublicRule[]> {
  const response = await api.get<{
    success: boolean
    message?: string
    data: { items: PublicRule[] }
  }>('/api/points/wallet/rules')
  return requireServerSuccess(response.data).data.items
}

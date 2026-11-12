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
  PointLedgerPage,
  PointLedgerQuery,
  PointLedgerScope,
} from './types'

export const pointLedgerQueryKey = (
  userId: number | undefined,
  scope: PointLedgerScope,
  params: PointLedgerQuery
) => ['point-ledger', userId, scope, params] as const

export async function getPointLedger(
  scope: PointLedgerScope,
  params: PointLedgerQuery
): Promise<PointLedgerPage> {
  const { user_id, ...shared } = params
  const query = scope === 'admin' ? params : shared
  const response = await api.get<{
    success: boolean
    message?: string
    data: PointLedgerPage
  }>(scope === 'admin' ? '/api/points/ledger' : '/api/points/ledger/self', {
    params: query,
  })
  return requireServerSuccess(response.data).data
}

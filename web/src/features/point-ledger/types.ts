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
export type PointLedgerType = { id: string; code: string; name: string }
export type PointLedgerItem = {
  id: string
  transaction_id: string
  account_id: string
  account_version: string
  freeze_id: string | null
  user_id: string
  username?: string
  point_type_id: string
  point_type_code: string
  point_type_name: string
  action: string
  biz_type: string
  biz_id: string
  related_transaction_id: string | null
  remark: string
  available_delta: string
  frozen_delta: string
  available_before: string
  available_after: string
  frozen_before: string
  frozen_after: string
  created_at: number
}
export type PointLedgerPage = {
  page: number
  page_size: number
  total: number
  items: PointLedgerItem[]
  point_types: PointLedgerType[]
}
export type PointLedgerScope = 'self' | 'admin'
export type PointLedgerFilters = {
  point_type_id?: string
  action?: string
  user_id?: string
  start_timestamp?: number
  end_timestamp?: number
}
export type PointLedgerQuery = PointLedgerFilters & {
  p: number
  page_size: number
}

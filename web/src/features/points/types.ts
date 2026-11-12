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
export type PointType = {
  id: number
  code: string
  name: string
  consume_priority: number
  created_at: number
  updated_at: number
}

export type PointModelRule = {
  id: number
  point_type_id: number
  match_type: 'EXACT' | 'PATTERN'
  match_value: string
  enabled: boolean
  created_at: number
  updated_at: number
}

export type PointRuleInput = Pick<
  PointModelRule,
  'match_type' | 'match_value' | 'enabled'
>

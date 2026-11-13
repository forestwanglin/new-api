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
export type RuleStyle = { fontWeight?: 400 | 700; color?: string; backgroundColor?: string }
export type RuleContent = { blocks: { type: 'paragraph'; children: { text: string; style?: RuleStyle }[] }[] }
export type RuleInput = { plan_id: string | null; rule_key: string; title: string; content: RuleContent; enabled: boolean; sort_order: number }
export type SubscriptionRule = RuleInput & { id: string; version: string; created_at: number; updated_at: number; plan: { id: string; title: string; code: string } | null }
export type PublicRule = Pick<SubscriptionRule, 'id' | 'rule_key' | 'title' | 'content'>
export type RuleFilters = { p: number; page_size: number; keyword?: string; enabled?: 'true' | 'false'; scope?: 'global' | 'plan'; plan_id?: string }
export type RuleList = { page: number; page_size: number; total: number; items: SubscriptionRule[] }

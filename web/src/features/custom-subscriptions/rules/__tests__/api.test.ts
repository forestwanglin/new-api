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
import { expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { deleteRule, getPublicRules, listRules, saveRule } from '../api'
import { defaultRuleInput } from '../schema'

it('allowlists writes and preserves string IDs and optimistic versions', async () => {
 const put = vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true, data: {} } })
 const rule = { ...defaultRuleInput, title: 'Rule', rule_key: 'renewal', id: '9007199254740993', version: '9007199254740994', unexpected: 'ignored' }
 await saveRule(rule, rule)
 expect(put).toHaveBeenCalledWith('/api/custom_subscription/admin/rules/9007199254740993', { plan_id: null, rule_key: 'renewal', title: 'Rule', content: rule.content, enabled: true, sort_order: 0, version: '9007199254740994' })
})
it('propagates business read and delete failures rather than claiming success', async () => {
 vi.spyOn(api, 'get').mockResolvedValue({ data: { success: false, message: 'Database unavailable' } })
 vi.spyOn(api, 'delete').mockResolvedValue({ data: { success: false, message: 'Subscription rule not found' } })
 await expect(listRules({ p: 1, page_size: 20 })).rejects.toThrow('Database unavailable')
 await expect(deleteRule('1')).rejects.toThrow('Subscription rule not found')
})
it('accepts an explicitly empty public result without static fallback', async () => {
 vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: { items: [] } } })
 await expect(getPublicRules()).resolves.toEqual([])
})

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
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import {
  deletePointRule,
  getPointRules,
  getPointTypes,
  savePointRule,
} from '../api'

describe('points API', () => {
  it('loads all types dynamically and scopes rules to their parent', async () => {
    const types = [{ id: 3, code: 'DS' }]
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValue({ data: { success: true, data: types } })
    expect(await getPointTypes()).toEqual(types)
    await getPointRules(3)
    expect(get).toHaveBeenNthCalledWith(1, '/api/points/types')
    expect(get).toHaveBeenNthCalledWith(2, '/api/points/types/3/rules')
  })
  it('writes only editable fields and preserves disabled updates', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true } })
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    const values = {
      match_type: 'EXACT' as const,
      match_value: 'Future/Model',
      enabled: false,
      point_type_id: 999,
    }
    await savePointRule(2, values)
    await savePointRule(2, values, 7)
    const expected = {
      match_type: 'EXACT',
      match_value: 'Future/Model',
      enabled: false,
    }
    expect(post).toHaveBeenCalledWith('/api/points/types/2/rules', expected)
    expect(put).toHaveBeenCalledWith('/api/points/types/2/rules/7', expected)
  })
  it('rejects business failures for reads, saves and deletes', async () => {
    const failure = { data: { success: false, message: 'Duplicate rule' } }
    vi.spyOn(api, 'get').mockResolvedValue(failure)
    vi.spyOn(api, 'post').mockResolvedValue(failure)
    vi.spyOn(api, 'delete').mockResolvedValue(failure)
    await expect(getPointTypes()).rejects.toThrow('Duplicate rule')
    await expect(
      savePointRule(1, {
        match_type: 'EXACT',
        match_value: 'gpt',
        enabled: true,
      })
    ).rejects.toThrow('Duplicate rule')
    await expect(deletePointRule(1, 2)).rejects.toThrow('Duplicate rule')
  })
})

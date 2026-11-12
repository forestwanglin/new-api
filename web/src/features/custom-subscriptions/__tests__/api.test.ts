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
  deletePlan,
  getPlan,
  listPlans,
  savePlan,
  subscriptionKeys,
} from '../api'
import { defaultPlanValues, toPlanInput } from '../lib/schema'

describe('custom subscriptions API', () => {
  it('scopes cache keys to viewer and every list filter', () => {
    expect(subscriptionKeys.list('1', { p: 1, page_size: 20 })).not.toEqual(
      subscriptionKeys.list('2', { p: 1, page_size: 20 })
    )
    expect(subscriptionKeys.list('1', { p: 1, page_size: 20 })).not.toEqual(
      subscriptionKeys.list('1', { p: 2, page_size: 20 })
    )
  })
  it('sends explicit configuration only and preserves update version', async () => {
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true, data: {} } })
    const input = toPlanInput({
      ...defaultPlanValues,
      price_yuan: '1',
      paid_points: '1',
    })
    await savePlan(
      { ...input, enabled: false },
      { id: '9007199254740993', version: '7' }
    )
    expect(put).toHaveBeenCalledWith(
      '/api/custom_subscription/admin/plans/9007199254740993',
      { ...input, enabled: false, version: '7' }
    )
  })
  it('rejects business failures for list, detail, create and delete', async () => {
    const failure = {
      data: { success: false, message: 'Plan has orders; disable it instead' },
    }
    vi.spyOn(api, 'get').mockResolvedValue(failure)
    vi.spyOn(api, 'post').mockResolvedValue(failure)
    vi.spyOn(api, 'delete').mockResolvedValue(failure)
    await expect(listPlans({ p: 1, page_size: 20 })).rejects.toThrow(
      'Plan has orders'
    )
    await expect(getPlan('1')).rejects.toThrow('Plan has orders')
    await expect(
      savePlan(
        toPlanInput({ ...defaultPlanValues, price_yuan: '1', paid_points: '1' })
      )
    ).rejects.toThrow('Plan has orders')
    await expect(deletePlan('1')).rejects.toThrow('Plan has orders')
  })
})

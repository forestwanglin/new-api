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
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { getUsers, searchUsers } from '../api'
import { userPointBalanceSchema, userSchema } from '../types'

const balance = {
  code: 'GENERAL',
  name: '通用积分',
  available_points: '9223372036854775807',
  frozen_points: '-9223372036854775808',
}
const user = {
  id: 1,
  username: 'test',
  display_name: '',
  quota: 0,
  used_quota: 0,
  request_count: 0,
  group: 'default',
  role: 1,
  status: 1,
}
afterEach(() => vi.restoreAllMocks())

it.each([getUsers, searchUsers])(
  'preserves precise point strings and pagination for %s',
  async (load) => {
    const response = {
      success: true,
      data: {
        items: [{ ...user, point_balances: [balance] }],
        total: 42,
        page: 2,
        page_size: 10,
      },
    }
    vi.spyOn(api, 'get').mockResolvedValue({ data: response })
    expect(await load({ p: 2 })).toEqual(response)
  }
)

it.each([
  '1.5',
  '01',
  '-0',
  'abc',
  '9223372036854775808',
  '-9223372036854775809',
  9007199254740992,
  null,
])('rejects invalid or numeric point amounts: %j', async (amount) => {
  const point = { ...balance, available_points: amount }
  expect(userPointBalanceSchema.safeParse(point).success).toBe(false)
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { items: [{ ...user, point_balances: [point] }] },
    },
  })
  await expect(getUsers()).rejects.toThrow()
  await expect(searchUsers({ keyword: 'test' })).rejects.toThrow()
})

it('accepts users without list-only points and does not rewrite server business failures', async () => {
  expect(userSchema.safeParse(user).success).toBe(true)
  const response = { success: false, message: 'point storage unavailable' }
  vi.spyOn(api, 'get').mockResolvedValue({ data: response })
  expect(await getUsers()).toEqual(response)
  expect(await searchUsers({})).toEqual(response)
})

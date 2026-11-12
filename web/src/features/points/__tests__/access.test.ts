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
import { afterEach, describe, expect, it } from 'vitest'

import { ROLE } from '@/lib/roles'
import { Route } from '@/routes/_authenticated/points'
import { useAuthStore } from '@/stores/auth-store'

const beforeLoad = Route.options.beforeLoad as () => void

afterEach(() => useAuthStore.getState().auth.reset())

describe('points route access', () => {
  it('redirects unauthenticated visitors to forbidden', () => {
    expect(beforeLoad).toThrow(
      expect.objectContaining({
        options: expect.objectContaining({ to: '/403' }),
      })
    )
  })
  it('redirects ordinary users to forbidden', () => {
    useAuthStore
      .getState()
      .auth.setUser({ id: 1, username: 'user', role: ROLE.USER })
    expect(beforeLoad).toThrow(
      expect.objectContaining({
        options: expect.objectContaining({ to: '/403' }),
      })
    )
  })
  it.each([ROLE.ADMIN, ROLE.SUPER_ADMIN])(
    'allows administrator role %s',
    (role) => {
      useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role })
      expect(beforeLoad).not.toThrow()
    }
  )
})

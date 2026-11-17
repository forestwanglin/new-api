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
import { describe, expect, it } from 'vitest'

import { transformFormDataToPayload, userFormSchema } from '../user-form'

describe('user edit balance validation', () => {
  it.each([-12.5, 0, 12.5])(
    'accepts an existing balance of %s when editing profile fields',
    (quota) => {
      const values = userFormSchema.parse({
        username: 'existing-user',
        display_name: 'Updated name',
        quota_dollars: quota,
      })
      const payload = transformFormDataToPayload(values, 42)
      expect(payload).toMatchObject({ id: 42, display_name: 'Updated name' })
      expect(payload).not.toHaveProperty('quota')
    }
  )

  it.each([Number.NaN, Infinity, -Infinity])(
    'rejects a non-finite balance of %s',
    (quota) => {
      expect(
        userFormSchema.safeParse({
          username: 'existing-user',
          quota_dollars: quota,
        }).success
      ).toBe(false)
    }
  )
})

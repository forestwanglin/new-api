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
import { renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { useTopNavLinks } from '@/hooks/use-top-nav-links'

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({
    status: {
      HeaderNavModules: JSON.stringify({
        pricing: { enabled: true },
        home: true,
        console: true,
      }),
    },
  }),
}))
it('places subscription immediately after model square', () => {
  const { result } = renderHook(() => useTopNavLinks())
  const links = result.current
  expect(links.findIndex((link) => link.href === '/subscription')).toBe(
    links.findIndex((link) => link.href === '/pricing') + 1
  )
})

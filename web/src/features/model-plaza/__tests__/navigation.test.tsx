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
        home: false,
        console: true,
        pricing: { enabled: true, requireAuth: false },
        rankings: { enabled: false, requireAuth: false },
        docs: false,
        about: false,
      }),
    },
  }),
}))

it('places the model plaza between the console entry and the model square', () => {
  const { result } = renderHook(() => useTopNavLinks())
  const hrefs = result.current.map((link) => link.href)
  expect(hrefs.slice(0, 3)).toEqual(['/dashboard', '/model', '/pricing'])
  expect(hrefs).toContain('/subscription')
})

it('labels the console entry as the homepage instead of the console', () => {
  const { result } = renderHook(() => useTopNavLinks())
  const consoleLink = result.current.find((link) => link.href === '/dashboard')
  expect(consoleLink).toBeDefined()
  expect(consoleLink?.title).not.toBe('Console')
})

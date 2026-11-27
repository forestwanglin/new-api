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
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveThemeRadiusPx } from '../theme-radius'

describe('resolveThemeRadiusPx', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('probes <body> so the token inherits the theme-scoped --radius', () => {
    // Capture the probe's parent at read time: the probe is removed before
    // resolveThemeRadiusPx returns, so it is detached by the time we assert.
    const parents: (Element | null)[] = []
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (element) => {
        parents.push(element.parentElement)
        return { borderTopLeftRadius: '9.6px' } as CSSStyleDeclaration
      }
    )

    expect(resolveThemeRadiusPx('--radius-md')).toBe(9.6)

    expect(parents).toHaveLength(1)
    expect(parents[0]).toBe(document.body)
  })

  it('returns undefined when the browser leaves the token unresolved', () => {
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({ borderTopLeftRadius: 'var(--radius-md)' }) as CSSStyleDeclaration
    )

    expect(resolveThemeRadiusPx('--radius-md')).toBeUndefined()
  })
})

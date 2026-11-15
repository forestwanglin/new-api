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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import {
  clearAffiliateCode,
  getAffiliateCode,
  saveAffiliateCode,
} from '../storage'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-15T00:00:00Z'))
})
afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

it('stores a trimmed invitation and keeps it across reads', () => {
  saveAffiliateCode(' iQO5 ')
  expect(getAffiliateCode()).toBe('iQO5')
  expect(localStorage.getItem('aff')).toBe('iQO5')
})

it.each(['', '   ', 'x'.repeat(33)])(
  'does not replace a pending invitation with invalid input %j',
  (code) => {
    saveAffiliateCode('iQO5')
    saveAffiliateCode(code)
    expect(getAffiliateCode()).toBe('iQO5')
  }
)

it('expires a saved invitation after thirty days', () => {
  saveAffiliateCode('iQO5')
  vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000)
  expect(getAffiliateCode()).toBe('')
  expect(localStorage.getItem('aff')).toBeNull()
})

it('accepts an existing plain invitation without a timestamp', () => {
  localStorage.setItem('aff', 'iQO5')
  expect(getAffiliateCode()).toBe('iQO5')
})

it('clears the completed invitation without deleting a newer one', () => {
  saveAffiliateCode('first')
  saveAffiliateCode('second')
  clearAffiliateCode('first')
  expect(getAffiliateCode()).toBe('second')
  clearAffiliateCode('second')
  expect(getAffiliateCode()).toBe('')
})

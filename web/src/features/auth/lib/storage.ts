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
/**
 * Utilities for managing authentication-related browser storage
 */

// ============================================================================
// LocalStorage Keys
// ============================================================================

const STORAGE_KEYS = {
  AFFILIATE: 'aff',
  AFFILIATE_SAVED_AT: 'aff_saved_at',
  STATUS: 'status',
} as const

// ============================================================================
// Affiliate Code Storage
// ============================================================================

const AFFILIATE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Get affiliate code from localStorage
 */
export function getAffiliateCode(): string {
  if (typeof window === 'undefined') return ''
  try {
    const code =
      window.localStorage.getItem(STORAGE_KEYS.AFFILIATE)?.trim() ?? ''
    if (!code || code.length > 32) return ''
    const savedAt = window.localStorage.getItem(STORAGE_KEYS.AFFILIATE_SAVED_AT)
    // Give existing plain affiliate codes the same lifetime from migration.
    if (savedAt === null) {
      window.localStorage.setItem(
        STORAGE_KEYS.AFFILIATE_SAVED_AT,
        String(Date.now())
      )
      return code
    }
    const timestamp = Number(savedAt)
    if (
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      timestamp > Date.now() ||
      Date.now() - timestamp >= AFFILIATE_LIFETIME_MS
    ) {
      window.localStorage.removeItem(STORAGE_KEYS.AFFILIATE)
      window.localStorage.removeItem(STORAGE_KEYS.AFFILIATE_SAVED_AT)
      return ''
    }
    return code
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to get affiliate code:', error)
    return ''
  }
}

/**
 * Save affiliate code to localStorage
 */
export function saveAffiliateCode(code: string): void {
  const normalized = code.trim()
  if (typeof window === 'undefined' || !normalized || normalized.length > 32) {
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEYS.AFFILIATE, normalized)
    window.localStorage.setItem(
      STORAGE_KEYS.AFFILIATE_SAVED_AT,
      String(Date.now())
    )
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save affiliate code:', error)
  }
}

/** Clear only the invitation that completed this authentication attempt. */
export function clearAffiliateCode(expectedCode: string): void {
  if (typeof window === 'undefined' || !expectedCode) return
  try {
    if (
      window.localStorage.getItem(STORAGE_KEYS.AFFILIATE)?.trim() !==
      expectedCode
    ) {
      return
    }
    window.localStorage.removeItem(STORAGE_KEYS.AFFILIATE)
    window.localStorage.removeItem(STORAGE_KEYS.AFFILIATE_SAVED_AT)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to clear affiliate code:', error)
  }
}

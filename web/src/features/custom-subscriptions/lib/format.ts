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
import { formatNumber } from '@/lib/format'

// Existing quota/currency helpers use Number and USD conversion; CNY minor
// units must stay exact, including amounts above Number.MAX_SAFE_INTEGER.
export function formatPlanPrice(minor: string, locale?: string): string {
  const value = BigInt(minor)
  const separator =
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((part) => part.type === 'decimal')?.value ?? '.'
  const fraction = [...(value % 100n).toString().padStart(2, '0')]
    .map((digit) => formatNumber(BigInt(digit), locale))
    .join('')
  return `¥ ${formatNumber(value / 100n, locale)}${separator}${fraction}`
}

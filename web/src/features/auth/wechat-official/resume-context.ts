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
import type { OfficialRequest } from './api'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`
      )
      .join(',')}}`
  }
  return JSON.stringify(value) ?? ''
}
export function matchesOfficialRequest(
  restored: OfficialRequest,
  requested: OfficialRequest
): boolean {
  if (restored.intent !== requested.intent) return false
  if (requested.intent === 'verify') {
    return (
      restored.intent === 'verify' &&
      restored.scope === requested.scope &&
      canonical(restored.context ?? {}) === canonical(requested.context ?? {})
    )
  }
  return requested.intent === 'bind'
}

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
import { getServerErrorSources } from './server-error-message'

/** Only accept recovery metadata from an explicit SMS business rejection. */
export function getSMSDeliveryRecovery(error: unknown) {
  for (const source of getServerErrorSources(error)) {
    const data = source.data
    if (
      !data ||
      typeof data !== 'object' ||
      !('code' in data) ||
      data.code !== 'SMS_DELIVERY_FAILED'
    ) {
      continue
    }
    const recovery = data as Record<string, unknown>
    const retryAfter = recovery.retry_after
    if (
      typeof retryAfter !== 'number' ||
      !Number.isSafeInteger(retryAfter) ||
      retryAfter < 0 ||
      retryAfter > 86400
    ) {
      continue
    }
    const expiresAt = recovery.retry_expires_at
    const retryToken = recovery.retry_token
    return {
      retryAfter,
      retryToken:
        typeof retryToken === 'string' &&
        typeof expiresAt === 'number' &&
        Number.isSafeInteger(expiresAt) &&
        expiresAt * 1000 > Date.now()
          ? retryToken
          : '',
      expiresAt: typeof expiresAt === 'number' ? expiresAt * 1000 : 0,
    }
  }
  return undefined
}

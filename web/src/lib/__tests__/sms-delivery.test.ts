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
import { expect, it } from 'vitest'

import { authResult } from '../secure-verification'
import { getSMSDeliveryRecovery } from '../sms-delivery'

it('preserves rejection recovery metadata through authenticated business errors', async () => {
  const response = {
    success: false,
    message: 'Delivery failed',
    data: {
      code: 'SMS_DELIVERY_FAILED',
      retry_token: 'bounded',
      retry_after: 90,
      retry_expires_at: Math.floor(Date.now() / 1000) + 120,
    },
  }
  const failure = await authResult(Promise.resolve({ data: response })).catch(
    (error: unknown) => error
  )
  expect(getSMSDeliveryRecovery(failure)).toEqual({
    retryAfter: 90,
    retryToken: 'bounded',
    expiresAt: response.data.retry_expires_at * 1000,
  })
})

it('never recovers expired, malformed or unrelated retry authorization', () => {
  const metadata = {
    code: 'SMS_DELIVERY_FAILED',
    retry_token: 'expired',
    retry_after: 90,
    retry_expires_at: 1,
  }
  expect(getSMSDeliveryRecovery({ data: metadata })).toEqual({
    retryAfter: 90,
    retryToken: '',
    expiresAt: 1000,
  })
  expect(
    getSMSDeliveryRecovery({ data: { ...metadata, retry_after: -1 } })
  ).toBeUndefined()
  expect(
    getSMSDeliveryRecovery({ data: { ...metadata, retry_after: Infinity } })
  ).toBeUndefined()
  expect(
    getSMSDeliveryRecovery({ data: { ...metadata, code: 'OTHER' } })
  ).toBeUndefined()
  expect(getSMSDeliveryRecovery({ config: { data: metadata } })).toBeUndefined()
})

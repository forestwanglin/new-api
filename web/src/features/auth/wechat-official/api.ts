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
import { api } from '@/lib/api'
import { createServerError } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import type { VerificationOperation } from '../secure-verification/types'

export type OfficialRequest =
  | { intent: 'login'; aff?: string }
  | { intent: 'bind' }
  | ({ intent: 'verify' } & VerificationOperation)
export interface OfficialFlow {
  flow_token: string
  qr_url: string
  expires_at: number
}
export type OfficialStatus =
  | 'pending'
  | 'scanning'
  | 'awaiting_consent'
  | 'authorized'
  | 'cancelled'
  | 'denied'
  | 'failed'
  | 'expired'
export async function officialBrowser(signal?: AbortSignal): Promise<string> {
  const response = await api.get('/api/oauth/wechat_official/browser', {
    signal,
    disableDuplicate: true,
    skipAuthRefresh: true,
  })
  if (!response.data.success) throw createServerError(response.data)
  return response.data.data.browser_token
}
export async function officialRequest<T>(
  path: string,
  body: object,
  token: string,
  signal?: AbortSignal
): Promise<T> {
  const response = await api.post(`/api/oauth/wechat_official/${path}`, body, {
    signal,
    headers: { 'X-Phone-Auth': token },
    skipAuthRefresh: true,
    singleUseAuthorization: Boolean(useAuthStore.getState().auth.session),
    skipBusinessError: true,
    skipErrorHandler: true,
  })
  if (!response.data.success) throw createServerError(response.data)
  return response.data.data as T
}

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

export interface PhoneCaptcha {
  challenge_token: string
  browser_token: string
  image: string
}

export async function getPhoneCaptcha(
  signal?: AbortSignal
): Promise<PhoneCaptcha> {
  const response = await api.get('/api/phone/captcha', {
    signal,
    disableDuplicate: true,
    skipAuthRefresh: true,
  })
  if (!response.data.success) throw createServerError(response.data)
  return response.data.data as PhoneCaptcha
}

export async function phoneAuthRequest<T>(
  path: string,
  body: object,
  browserToken: string,
  signal?: AbortSignal
): Promise<T> {
  const response = await api.post(path, body, {
    signal,
    headers: { 'X-Phone-Auth': browserToken },
    skipAuthRefresh: true,
    skipBusinessError: true,
    skipErrorHandler: true,
  })
  if (!response.data.success) throw createServerError(response.data)
  return response.data.data as T
}

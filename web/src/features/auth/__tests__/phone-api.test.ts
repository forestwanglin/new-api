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
import { AxiosError, type AxiosAdapter } from 'axios'
import { afterEach, expect, it } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { phoneAuthRequest } from '../phone-api'

const originalAdapter = api.defaults.adapter
afterEach(() => {
  api.defaults.adapter = originalAdapter
  useAuthStore.getState().auth.reset()
})

it('sends anonymous phone and WeChat POST requests without requiring a session refresh', async () => {
  useAuthStore.getState().auth.reset()
  const paths: string[] = []
  const adapter: AxiosAdapter = async (config) => {
    paths.push(config.url ?? '')
    expect(config.headers.get('X-Phone-Auth')).toBe('browser-nonce')
    return {
      data: { success: true, data: { send_token: 'permit' } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  api.defaults.adapter = adapter
  await phoneAuthRequest(
    '/api/phone/captcha/verify',
    { answer: '12345' },
    'browser-nonce'
  )
  await phoneAuthRequest(
    '/api/oauth/wechat',
    { code: '123456' },
    'browser-nonce'
  )
  expect(paths).toEqual(['/api/phone/captcha/verify', '/api/oauth/wechat'])
})

it('does not replay an anonymous one-time phone authorization after a 401', async () => {
  useAuthStore.getState().auth.reset()
  const paths: string[] = []
  api.defaults.adapter = async (config) => {
    paths.push(config.url ?? '')
    throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, {
      data: { success: false, message: 'Expired' },
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config,
    })
  }
  await expect(
    phoneAuthRequest(
      '/api/phone/login',
      { sms_token: 'one-time' },
      'browser-nonce'
    )
  ).rejects.toThrow()
  expect(paths).toEqual(['/api/phone/login'])
})

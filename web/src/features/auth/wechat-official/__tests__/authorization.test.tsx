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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { OfficialWeChatAuthorization } from '../authorization'
import { matchesOfficialRequest } from '../resume-context'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
const flow = {
  flow_token: 'owner-secret',
  qr_url:
    'https://site.test/api/oauth/wechat_official/start?r=scanner-reference',
  expires_at: Math.floor(Date.now() / 1000) + 300,
}
beforeEach(() => {
  sessionStorage.clear()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { browser_token: 'browser' } },
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
})
function response(data: unknown) {
  return { data: { success: true, data } }
}
it('does not start a flow before legal consent', async () => {
  render(
    <OfficialWeChatAuthorization
      request={{ intent: 'login' }}
      enabled={false}
      onResult={vi.fn()}
    />
  )
  expect(
    screen.getByText('Accept the terms before authorizing with WeChat.')
  ).toBeInTheDocument()
  expect(api.get).not.toHaveBeenCalled()
})
it('consumes authorized login once and keeps owner capability outside QR and browser storage', async () => {
  const result = vi.fn()
  vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url.endsWith('/flows')) return response(flow)
    if (url.endsWith('/status')) return response({ status: 'authorized' })
    if (url.endsWith('/complete')) {
      return response({
        require_phone_binding: true,
        bind_token: 'phone-secret',
      })
    }
    return response({})
  })
  render(
    <OfficialWeChatAuthorization
      request={{ intent: 'login', aff: 'invite' }}
      onResult={result}
    />
  )
  await waitFor(() =>
    expect(result).toHaveBeenCalledWith(
      {
        require_phone_binding: true,
        bind_token: 'phone-secret',
      },
      { intent: 'login', aff: 'invite' }
    )
  )
  expect(api.post).toHaveBeenCalledWith(
    expect.stringContaining('/flows'),
    expect.objectContaining({ aff: 'invite' }),
    expect.objectContaining({
      headers: { 'X-Phone-Auth': 'browser' },
      skipAuthRefresh: true,
    })
  )
  expect(api.post).toHaveBeenCalledWith(
    expect.stringContaining('/complete'),
    { flow_token: flow.flow_token },
    expect.not.objectContaining({ singleUseAuthorization: true })
  )
  expect(document.body.innerHTML).not.toContain('owner-secret')
  expect(sessionStorage.length).toBe(0)
})
it('cancels an outstanding flow after polling failure and before QR refresh', async () => {
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url.endsWith('/flows')) return response(flow)
    if (url.endsWith('/status')) throw new Error('network unavailable')
    return response({})
  })
  render(
    <OfficialWeChatAuthorization
      request={{ intent: 'bind' }}
      onResult={vi.fn()}
    />
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Refresh QR code' })
  )
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/cancel'),
      { flow_token: flow.flow_token },
      expect.any(Object)
    )
  )
})
it('resumes same-device verification only with the exact operation and does not create another QR', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('MicroMessenger')
  const result = vi.fn()
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url.endsWith('/resume')) {
      return response({
        ...flow,
        status: 'authorized',
        intent: 'verify',
        scope: 'access_token.update',
        context: { scopes: ['tokens:read'], token_id: 4 },
      })
    }
    if (url.endsWith('/status')) return response({ status: 'authorized' })
    return response({
      proof_token: 'proof',
      scope: 'access_token.update',
      method: 'wechat',
    })
  })
  render(
    <OfficialWeChatAuthorization
      request={{
        intent: 'verify',
        scope: 'access_token.update',
        context: { token_id: 4, scopes: ['tokens:read'] },
      }}
      onResult={result}
    />
  )
  await waitFor(() => expect(result).toHaveBeenCalled())
  expect(post.mock.calls.some(([url]) => url.endsWith('/flows'))).toBe(false)
})
it('matches context key order but rejects changed expiry, grants, token, scope and intent', () => {
  const request = {
    intent: 'verify' as const,
    scope: 'access_token.generate' as const,
    context: { scopes: ['tokens:read'], expires_at: 99 },
  }
  expect(
    matchesOfficialRequest(
      { ...request, context: { expires_at: 99, scopes: ['tokens:read'] } },
      request
    )
  ).toBe(true)
  expect(
    matchesOfficialRequest(
      { ...request, context: { ...request.context, expires_at: 100 } },
      request
    )
  ).toBe(false)
  expect(
    matchesOfficialRequest(
      { ...request, context: { ...request.context, scopes: ['tokens:write'] } },
      request
    )
  ).toBe(false)
  expect(
    matchesOfficialRequest(
      {
        intent: 'verify',
        scope: 'access_token.revoke',
        context: { token_id: 4 },
      },
      {
        intent: 'verify',
        scope: 'access_token.revoke',
        context: { token_id: 5 },
      }
    )
  ).toBe(false)
  expect(matchesOfficialRequest({ intent: 'bind' }, request)).toBe(false)
})

it('pauses status requests while hidden and resumes when the originating page becomes visible', async () => {
  let hidden = true
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url.endsWith('/flows')) return response(flow)
    return response({ status: 'denied' })
  })
  render(
    <OfficialWeChatAuthorization
      request={{ intent: 'login' }}
      onResult={vi.fn()}
    />
  )
  await screen.findByTitle('WeChat authorization QR code')
  expect(post.mock.calls.some(([url]) => url.endsWith('/status'))).toBe(false)
  hidden = false
  document.dispatchEvent(new Event('visibilitychange'))
  await screen.findByText(
    'WeChat authorization ended. Please refresh the QR code.'
  )
})
it('ignores an authorized response after unmount and cancels the old owner flow', async () => {
  let finish!: (value: ReturnType<typeof response>) => void
  const pending = new Promise<ReturnType<typeof response>>((resolve) => {
    finish = resolve
  })
  const result = vi.fn()
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url.endsWith('/flows')) return response(flow)
    if (url.endsWith('/status')) return pending
    return response({})
  })
  const view = render(
    <OfficialWeChatAuthorization
      request={{ intent: 'login' }}
      onResult={result}
    />
  )
  await screen.findByTitle('WeChat authorization QR code')
  view.unmount()
  finish(response({ status: 'authorized' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/cancel'),
      { flow_token: flow.flow_token },
      expect.any(Object)
    )
  )
  expect(result).not.toHaveBeenCalled()
  expect(post.mock.calls.some(([url]) => url.endsWith('/complete'))).toBe(false)
})
it('replaces a failed same-device ceremony when the user refreshes instead of resuming it again', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('MicroMessenger')
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url.endsWith('/resume')) {
      return response({ ...flow, intent: 'bind', status: 'failed' })
    }
    if (url.endsWith('/flows')) return response(flow)
    return response({ status: 'failed' })
  })
  render(
    <OfficialWeChatAuthorization
      request={{ intent: 'bind' }}
      onResult={vi.fn()}
    />
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Refresh QR code' })
  )
  await waitFor(() =>
    expect(
      post.mock.calls.filter(([url]) => url.endsWith('/flows'))
    ).toHaveLength(2)
  )
  expect(
    post.mock.calls.filter(([url]) => url.endsWith('/resume'))
  ).toHaveLength(1)
})

it('keeps the QR code on a rounded white surface with a four-module quiet zone', async () => {
  vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url.endsWith('/flows')) return response(flow)
    return response({ status: 'pending' })
  })
  render(
    <OfficialWeChatAuthorization
      request={{ intent: 'login' }}
      onResult={vi.fn()}
    />
  )
  const qr = (await screen.findByTitle('WeChat authorization QR code')).closest(
    'svg'
  )
  // The quiet zone is inside the SVG so it survives scaling and dark themes.
  expect(qr).toHaveAttribute('viewBox', '0 0 41 41')
  expect(qr?.parentElement).toHaveClass('rounded-2xl', 'bg-white', 'p-2')
})

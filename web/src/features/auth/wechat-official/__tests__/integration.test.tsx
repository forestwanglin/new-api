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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { WeChatBindDialog } from '@/features/security/components/dialogs/wechat-bind-dialog'
import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import {
  SecureVerificationDialog,
  useSecureVerification,
} from '../../secure-verification'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
let client: QueryClient
function ok(data: unknown) {
  return { data: { success: true, data } }
}
const expires = () => Math.floor(Date.now() / 1000) + 300
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(STATUS_QUERY_KEY, {
    wechat_official_login: true,
    wechat_login: false,
  })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url.endsWith('/browser')) return ok({ browser_token: 'browser' })
    if (url.endsWith('/bind/verification')) {
      return ok({ sms_required: true, phone_masked: '138****0000' })
    }
    return ok({
      methods: [{ method: 'wechat', available: true }],
      wechat_methods: ['official'],
      oauth_providers: [],
      password_encryption_enabled: false,
    })
  })
})
afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
  sessionStorage.clear()
})
it('authorizes a binding assertion before SMS and consumes proof for that exact assertion', async () => {
  const success = vi.fn()
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url.endsWith('/flows')) {
      return ok({
        flow_token: 'flow',
        qr_url: 'https://site.test/start',
        expires_at: expires(),
      })
    }
    if (url.endsWith('/status')) return ok({ status: 'authorized' })
    if (url.endsWith('/complete')) {
      return ok({ assertion_token: 'bound-assertion', expires_at: expires() })
    }
    if (url.endsWith('/sms/send')) {
      return ok({ sms_token: 'sms', retry_after: 90 })
    }
    if (url.endsWith('/sms/verify')) return ok({ proof_token: 'proof' })
    return ok({})
  })
  render(
    <QueryClientProvider client={client}>
      <WeChatBindDialog
        open
        qrCodeUrl=''
        onOpenChange={vi.fn()}
        onSuccess={success}
      />
    </QueryClientProvider>
  )
  await screen.findByText(
    'WeChat authorization completed. Confirm binding to continue.'
  )
  expect(
    screen.queryByLabelText('WeChat verification code')
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Bind' })).toBeDisabled()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Send code' }))
  await user.type(screen.getByLabelText('SMS verification code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Bind' }))
  await waitFor(() => expect(success).toHaveBeenCalledOnce())
  expect(post).toHaveBeenCalledWith(
    '/api/oauth/wechat_official/bind/sms/send',
    { assertion_token: 'bound-assertion' },
    expect.objectContaining({ headers: { 'X-Phone-Auth': 'browser' } })
  )
  expect(post).toHaveBeenCalledWith(
    '/api/oauth/wechat_official/bind',
    { assertion_token: 'bound-assertion' },
    expect.objectContaining({
      headers: { 'X-Security-Proof': 'proof', 'X-Phone-Auth': 'browser' },
    })
  )
  expect(
    post.mock.calls.some(([url]) => url === '/api/oauth/wechat/bind')
  ).toBe(false)
})
function ProofConsumer() {
  const verification = useSecureVerification()
  const [result, setResult] = useState('')
  return (
    <>
      <button
        type='button'
        onClick={() =>
          void verification
            .requestVerification({
              scope: 'access_token.revoke',
              context: { token_id: 7 },
            })
            .then((proof) => setResult(proof?.proof_token ?? 'cancelled'))
        }
      >
        Start action
      </button>
      <p>{result}</p>
      <SecureVerificationDialog {...verification.dialogProps} />
    </>
  )
}
it('uses the dynamic authorization proof directly without submitting a legacy verification code', async () => {
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url.endsWith('/flows')) {
      return ok({
        flow_token: 'verify-flow',
        qr_url: 'https://site.test/start',
        expires_at: expires(),
      })
    }
    if (url.endsWith('/status')) return ok({ status: 'authorized' })
    return ok({
      proof_token: 'official-proof',
      scope: 'access_token.revoke',
      method: 'wechat',
      expires_at: expires(),
    })
  })
  render(<ProofConsumer />)
  await userEvent.click(screen.getByRole('button', { name: 'Start action' }))
  await screen.findByText('official-proof')
  expect(post.mock.calls.some(([url]) => url === '/api/verify')).toBe(false)
  expect(post).toHaveBeenCalledWith(
    '/api/oauth/wechat_official/flows',
    expect.objectContaining({
      intent: 'verify',
      scope: 'access_token.revoke',
      context: { token_id: 7 },
    }),
    expect.any(Object)
  )
})

it('rejects a proof for another scope and keeps the sensitive operation uncompleted', async () => {
  vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url.endsWith('/flows')) {
      return ok({
        flow_token: 'flow',
        qr_url: 'https://site.test/start',
        expires_at: expires(),
      })
    }
    if (url.endsWith('/status')) return ok({ status: 'authorized' })
    return ok({
      proof_token: 'wrong-scope-proof',
      scope: 'phone.binding',
      method: 'wechat',
      expires_at: expires(),
    })
  })
  render(<ProofConsumer />)
  await userEvent.click(screen.getByRole('button', { name: 'Start action' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Invalid verification result'
  )
  expect(screen.queryByText('wrong-scope-proof')).not.toBeInTheDocument()
  expect(
    screen.getByRole('dialog', { name: 'Security verification' })
  ).toBeVisible()
})

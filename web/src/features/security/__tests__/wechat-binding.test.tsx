import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { WeChatBindDialog } from '../components/dialogs/wechat-bind-dialog'

beforeEach(() => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'phone-user', role: 1 })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { sms_required: true, phone_masked: '138****8000' },
    },
  })
})
afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.reset('idle')
  vi.restoreAllMocks()
})

function renderBinding() {
  const onSuccess = vi.fn()
  const view = render(
    <WeChatBindDialog
      open
      qrCodeUrl='https://example.test/qr'
      onOpenChange={vi.fn()}
      onSuccess={onSuccess}
    />
  )
  return { ...view, onSuccess }
}

it('verifies the bound phone before submitting the WeChat code and scoped proof', async () => {
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url.endsWith('/sms/send')) {
      return {
        data: {
          success: true,
          data: { sms_token: 'sms-flow', retry_after: 90 },
        },
      }
    }
    if (url.endsWith('/sms/verify')) {
      return { data: { success: true, data: { proof_token: 'sms-proof' } } }
    }
    return { data: { success: true, data: {} } }
  })
  const user = userEvent.setup()
  const { onSuccess } = renderBinding()
  const sms = await screen.findByLabelText('SMS verification code')
  expect(screen.getByText(/138\*\*\*\*8000/)).toBeVisible()
  expect(sms).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Bind' })).toBeDisabled()
  await user.type(screen.getByLabelText('WeChat verification code'), 'wx-123')
  await user.click(screen.getByRole('button', { name: 'Send code' }))
  expect(
    await screen.findByRole('button', { name: 'Resend in 90s' })
  ).toBeDisabled()
  await user.type(sms, '123456')
  await user.click(screen.getByRole('button', { name: 'Bind' }))
  await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
  expect(post).toHaveBeenCalledWith(
    '/api/oauth/wechat/bind/sms/verify',
    { code: 'wx-123', sms_token: 'sms-flow', sms_code: '123456' },
    expect.objectContaining({ singleUseAuthorization: true })
  )
  expect(post).toHaveBeenLastCalledWith(
    '/api/oauth/wechat/bind',
    { code: 'wx-123' },
    expect.objectContaining({ headers: { 'X-Security-Proof': 'sms-proof' } })
  )
  expect(
    screen.queryByRole('dialog', { name: 'Security verification' })
  ).not.toBeInTheDocument()
})

it('clears the SMS authorization when the WeChat code changes', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { sms_token: 'sms-flow', retry_after: 90 } },
  })
  const user = userEvent.setup()
  renderBinding()
  await screen.findByLabelText('SMS verification code')
  const wechat = screen.getByLabelText('WeChat verification code')
  await user.type(wechat, 'wx-123')
  await user.click(screen.getByRole('button', { name: 'Send code' }))
  await user.type(screen.getByLabelText('SMS verification code'), '123456')
  expect(screen.getByRole('button', { name: 'Bind' })).toBeEnabled()
  await user.type(wechat, 'changed')
  expect(screen.getByLabelText('SMS verification code')).toHaveValue('')
  expect(screen.getByLabelText('SMS verification code')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Bind' })).toBeDisabled()
})

it('does not submit a binding when the SMS verification fails', async () => {
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url.endsWith('/sms/send')) {
      return {
        data: {
          success: true,
          data: { sms_token: 'sms-flow', retry_after: 90 },
        },
      }
    }
    return {
      data: {
        success: false,
        message: 'Verification code is incorrect or has expired',
        code: 'PHONE_VERIFICATION_FAILED',
      },
    }
  })
  const user = userEvent.setup()
  const { onSuccess } = renderBinding()
  await screen.findByLabelText('SMS verification code')
  await user.type(screen.getByLabelText('WeChat verification code'), 'wx-123')
  await user.click(screen.getByRole('button', { name: 'Send code' }))
  await user.type(screen.getByLabelText('SMS verification code'), '000000')
  await user.click(screen.getByRole('button', { name: 'Bind' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  expect(onSuccess).not.toHaveBeenCalled()
  expect(post.mock.calls.map(([url]) => url)).not.toContain(
    '/api/oauth/wechat/bind'
  )
})

it('discards pending SMS delivery after switching accounts', async () => {
  let finish!: (value: unknown) => void
  const post = vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const user = userEvent.setup()
  renderBinding()
  await screen.findByLabelText('SMS verification code')
  await user.type(screen.getByLabelText('WeChat verification code'), 'wx-123')
  await user.click(screen.getByRole('button', { name: 'Send code' }))
  await act(async () => {
    useAuthStore.getState().auth.setUser({ id: 2, username: 'other', role: 1 })
  })
  expect(post.mock.calls[0][2]?.signal?.aborted).toBe(true)
  await act(async () =>
    finish({
      data: { success: true, data: { sms_token: 'stale', retry_after: 90 } },
    })
  )
  expect(screen.getByLabelText('WeChat verification code')).toHaveValue('')
  expect(await screen.findByLabelText('SMS verification code')).toBeDisabled()
})

it('retains existing security verification when SMS is not selected by the server', async () => {
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/oauth/wechat/bind/verification'
          ? { sms_required: false }
          : {
              scope: 'account.binding.bind',
              methods: [{ method: 'password', available: true }],
              oauth_providers: [],
              password_encryption_enabled: false,
            },
    },
  }))
  const user = userEvent.setup()
  renderBinding()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Bind' })).toBeEnabled()
  )
  await user.type(screen.getByLabelText('WeChat verification code'), 'wx-123')
  await user.click(screen.getByRole('button', { name: 'Bind' }))
  expect(
    await screen.findByLabelText('Password', { selector: 'input' })
  ).toBeVisible()
  expect(
    screen.queryByLabelText('SMS verification code')
  ).not.toBeInTheDocument()
})

it('keeps binding disabled when verification availability cannot be loaded', async () => {
  vi.mocked(api.get).mockRejectedValue(new Error('Network unavailable'))
  renderBinding()
  expect(
    await screen.findByText(
      'Unable to load verification methods. Close this dialog and try again.'
    )
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Bind' })).toBeDisabled()
})

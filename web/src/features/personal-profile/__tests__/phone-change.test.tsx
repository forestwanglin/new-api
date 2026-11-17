import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render as renderView,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { PhoneChangeDialog } from '../phone-change-dialog'

function render(component: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderView(
    <QueryClientProvider client={queryClient}>{component}</QueryClientProvider>
  )
}

beforeEach(() => {
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: {} } })
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'phone-owner', role: 1 })
})
afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.reset('idle')
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it.each(['send', 'submit'])(
  'restarts old-phone verification when its proof expires before %s',
  async (action) => {
    const post = vi
      .spyOn(api, 'post')
      .mockImplementation(async (_url, body) => {
        const data = body as { step: string }
        return {
          data: {
            success: true,
            data: { token: `${data.step}-token`, retry_after: 90 },
          },
        }
      })
    const user = userEvent.setup()
    render(
      <PhoneChangeDialog
        open
        status={{
          bound: true,
          phone_masked: '138****8000',
          verification_required: false,
        }}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />
    )
    await user.click(await screen.findByRole('button', { name: 'Get code' }))
    await user.type(screen.getByLabelText('Verification code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.type(
      await screen.findByLabelText('New phone number'),
      '13900139000'
    )
    if (action === 'submit') {
      await user.click(screen.getByRole('button', { name: 'Get code' }))
      await user.type(screen.getByLabelText('Verification code'), '654321')
    }
    const calls = post.mock.calls.length
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 10 * 60 * 1000)
    await user.click(
      screen.getByRole('button', {
        name: action === 'send' ? 'Get code' : 'Confirm change',
      })
    )
    expect(post).toHaveBeenCalledTimes(calls)
    expect(await screen.findByLabelText('Current phone number')).toHaveValue(
      '138****8000'
    )
    expect(screen.getByLabelText('Verification code')).toHaveValue('')
    expect(screen.getByLabelText('Verification code')).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Get code' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Security verification has expired. Please verify again.'
    )
  }
)

it('prevents changing the target number while SMS delivery is pending', async () => {
  let finish!: (result: {
    data: { success: boolean; data: { token: string; retry_after: number } }
  }) => void
  vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const user = userEvent.setup()
  render(
    <PhoneChangeDialog
      open
      status={{ bound: false, phone_masked: '', verification_required: true }}
      bindingAuthorization={{
        token: 'binding-auth',
        expires_at: Date.now() / 1000 + 600,
      }}
      onOpenChange={vi.fn()}
      onSuccess={vi.fn()}
    />
  )
  const phone = await screen.findByLabelText('New phone number')
  await user.type(phone, '13900139000')
  await user.click(screen.getByRole('button', { name: 'Get code' }))
  expect(phone).toBeDisabled()
  finish({ data: { success: true, data: { token: 'sms', retry_after: 90 } } })
  await waitFor(() => expect(phone).toBeEnabled())
})

it('verifies both numbers and sends the old verification token with the new SMS', async () => {
  const post = vi.spyOn(api, 'post').mockImplementation(async (url, body) => {
    const data = body as { step?: string }
    if (url.endsWith('/send')) {
      return {
        data: {
          success: true,
          data: { token: `${data.step}-sms`, retry_after: 90 },
        },
      }
    }
    if (url.endsWith('/verify')) {
      return {
        data: { success: true, data: { token: `${data.step}-verified` } },
      }
    }
    return { data: { success: true, data: {} } }
  })
  const onSuccess = vi.fn()
  const user = userEvent.setup()
  render(
    <PhoneChangeDialog
      open
      status={{
        bound: true,
        phone_masked: '138****8000',
        verification_required: false,
      }}
      onOpenChange={vi.fn()}
      onSuccess={onSuccess}
    />
  )
  expect(await screen.findByLabelText('Current phone number')).toHaveValue(
    '138****8000'
  )
  await user.click(screen.getByRole('button', { name: 'Get code' }))
  expect(
    await screen.findByRole('button', { name: 'Resend in 90s' })
  ).toBeDisabled()
  await user.type(screen.getByLabelText('Verification code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.type(
    await screen.findByLabelText('New phone number'),
    '13900139000'
  )
  await user.click(screen.getByRole('button', { name: 'Get code' }))
  expect(post).toHaveBeenCalledWith(
    '/api/user/phone/change/send',
    { step: 'new', phone: '13900139000', verification_token: 'old-verified' },
    expect.objectContaining({ singleUseAuthorization: true })
  )
  await user.type(screen.getByLabelText('Verification code'), '654321')
  await user.click(screen.getByRole('button', { name: 'Confirm change' }))
  await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
  expect(post).toHaveBeenLastCalledWith(
    '/api/user/phone/change/complete',
    { token: 'new-verified' },
    expect.objectContaining({
      acceptAuthRotation: true,
      singleUseAuthorization: true,
    })
  )
})

it('changing the new number clears its SMS authorization and entered code', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { token: 'new-sms', retry_after: 90 } },
  })
  const user = userEvent.setup()
  render(
    <PhoneChangeDialog
      open
      status={{ bound: false, phone_masked: '', verification_required: true }}
      bindingAuthorization={{
        token: 'binding-auth',
        expires_at: Date.now() / 1000 + 600,
      }}
      onOpenChange={vi.fn()}
      onSuccess={vi.fn()}
    />
  )
  await user.type(
    await screen.findByLabelText('New phone number'),
    '13900139000'
  )
  await user.click(screen.getByRole('button', { name: 'Get code' }))
  await user.type(screen.getByLabelText('Verification code'), '123456')
  expect(screen.getByRole('button', { name: 'Confirm binding' })).toBeEnabled()
  await user.type(screen.getByLabelText('New phone number'), '{Backspace}1')
  expect(screen.getByLabelText('Verification code')).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Confirm binding' })).toBeDisabled()
})

it('shows failed SMS verification inline and keeps the old-phone step', async () => {
  vi.spyOn(api, 'post').mockImplementation(async (url) =>
    url.endsWith('/send')
      ? { data: { success: true, data: { token: 'sms', retry_after: 90 } } }
      : {
          data: {
            success: false,
            message: 'Verification failed. Please try again.',
          },
        }
  )
  const user = userEvent.setup()
  render(
    <PhoneChangeDialog
      open
      status={{
        bound: true,
        phone_masked: '138****8000',
        verification_required: false,
      }}
      onOpenChange={vi.fn()}
      onSuccess={vi.fn()}
    />
  )
  await user.click(await screen.findByRole('button', { name: 'Get code' }))
  await user.type(screen.getByLabelText('Verification code'), '000000')
  await user.click(screen.getByRole('button', { name: 'Next' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Verification failed. Please try again.'
  )
  expect(screen.getByLabelText('Current phone number')).toHaveValue(
    '138****8000'
  )
})

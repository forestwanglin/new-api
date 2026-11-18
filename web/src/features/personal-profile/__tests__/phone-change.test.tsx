import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  fireEvent,
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
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        challenge_token: 'image-token',
        image: 'data:image/png;base64,AA==',
      },
    },
  })
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
    await waitFor(() =>
      expect(screen.getByLabelText('Image verification code')).toBeEnabled()
    )
    await user.type(
      await screen.findByLabelText('Image verification code'),
      '12345'
    )
    await user.click(await screen.findByRole('button', { name: 'Get code' }))
    await user.type(screen.getByLabelText('Verification code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.type(
      await screen.findByLabelText('New phone number'),
      '13900139000'
    )
    if (action === 'submit') {
      await waitFor(() =>
        expect(screen.getByLabelText('Image verification code')).toBeEnabled()
      )
      await user.type(screen.getByLabelText('Image verification code'), '12345')
      await user.click(screen.getByRole('button', { name: 'Get code' }))
      await user.type(screen.getByLabelText('Verification code'), '654321')
    }
    if (action === 'send') {
      await waitFor(() =>
        expect(screen.getByLabelText('Image verification code')).toBeEnabled()
      )
      await user.type(screen.getByLabelText('Image verification code'), '12345')
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
    expect(screen.getByRole('button', { name: 'Get code' })).toBeDisabled()
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
  await waitFor(() =>
    expect(screen.getByLabelText('Image verification code')).toBeEnabled()
  )
  await user.type(screen.getByLabelText('Image verification code'), '12345')
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
    return {
      data: {
        success: true,
        data: {
          challenge_token: 'image-token',
          image: 'data:image/png;base64,AA==',
        },
      },
    }
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
  await waitFor(() =>
    expect(screen.getByLabelText('Image verification code')).toBeEnabled()
  )
  await user.type(screen.getByLabelText('Image verification code'), '12345')
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
  await waitFor(() =>
    expect(screen.getByLabelText('Image verification code')).toBeEnabled()
  )
  await user.type(screen.getByLabelText('Image verification code'), '12345')
  await user.click(screen.getByRole('button', { name: 'Get code' }))
  expect(post).toHaveBeenCalledWith(
    '/api/user/phone/change/send',
    {
      step: 'new',
      phone: '13900139000',
      verification_token: 'old-verified',
      captcha_token: 'image-token',
      captcha_answer: '12345',
    },
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
  await waitFor(() =>
    expect(screen.getByLabelText('Image verification code')).toBeEnabled()
  )
  await user.type(screen.getByLabelText('Image verification code'), '12345')
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
  await waitFor(() =>
    expect(screen.getByLabelText('Image verification code')).toBeEnabled()
  )
  await user.type(
    await screen.findByLabelText('Image verification code'),
    '12345'
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

it.each([true, false])(
  'keeps the image and answer after phone SMS delivery succeeds=%s until explicitly refreshed',
  async (success) => {
    let image = 0
    const get = vi.mocked(api.get).mockImplementation(async (url) => ({
      data: {
        success: true,
        data: {
          challenge_token: `image-${url.endsWith('/captcha') ? ++image : image}`,
          image: `data:image/png;base64,${image === 1 ? 'AA==' : 'AQ=='}`,
        },
      },
    }))
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue(
        success
          ? { data: { success: true, data: { token: 'sms', retry_after: 0 } } }
          : { data: { success: false, message: 'Delivery failed' } }
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
    const answer = screen.getByLabelText('Image verification code')
    await waitFor(() => expect(answer).toBeEnabled())
    await user.type(answer, '12345')
    const send = screen.getByRole('button', { name: 'Get code' })
    const source = screen
      .getByRole('img', { name: 'Image verification code' })
      .getAttribute('src')
    await user.click(send)
    if (!success) {
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Delivery failed'
      )
    }
    await waitFor(() => expect(answer).toBeEnabled())
    expect(answer).toHaveValue('12345')
    expect(answer).toHaveAttribute('readonly')
    expect(
      screen.getByRole('img', { name: 'Image verification code' })
    ).toHaveAttribute('src', source)
    expect(
      get.mock.calls.filter(([url]) => url.endsWith('/captcha'))
    ).toHaveLength(1)
    expect(send).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Refresh image code' }))
    await waitFor(() => expect(answer).toHaveValue(''))
    await waitFor(() => expect(answer).toBeEnabled())
    await user.type(answer, '54321')
    await waitFor(() => expect(send).toBeEnabled())
    await user.click(send)
    expect(post).toHaveBeenLastCalledWith(
      '/api/user/phone/change/send',
      expect.objectContaining({
        captcha_token: 'image-2',
        captcha_answer: '54321',
      }),
      expect.anything()
    )
  }
)

it('allows image refresh after loading fails and does not send SMS without a valid challenge', async () => {
  let failImage = true
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url.endsWith('/captcha') && failImage) {
      return { data: { success: false, message: 'Image unavailable' } }
    }
    return {
      data: {
        success: true,
        data: {
          challenge_token: 'image-token',
          image: 'data:image/png;base64,AA==',
        },
      },
    }
  })
  const post = vi.spyOn(api, 'post')
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
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Image unavailable'
  )
  expect(screen.getByRole('button', { name: 'Get code' })).toBeDisabled()
  failImage = false
  await user.click(screen.getByRole('button', { name: 'Refresh image code' }))
  await waitFor(() =>
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  )
  await user.type(screen.getByLabelText('Image verification code'), '12345')
  expect(screen.getByRole('button', { name: 'Get code' })).toBeEnabled()
  expect(post).not.toHaveBeenCalled()
})

it('blocks SMS when refreshing an existing image fails instead of reusing the old challenge', async () => {
  const post = vi.spyOn(api, 'post')
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
  await waitFor(() =>
    expect(screen.getByLabelText('Image verification code')).toBeEnabled()
  )
  await user.type(screen.getByLabelText('Image verification code'), '12345')
  expect(screen.getByRole('button', { name: 'Get code' })).toBeEnabled()
  vi.mocked(api.get).mockResolvedValue({
    data: { success: false, message: 'Image unavailable' },
  })
  await user.click(screen.getByRole('button', { name: 'Refresh image code' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Image unavailable'
  )
  await user.type(screen.getByLabelText('Image verification code'), '54321')
  expect(screen.getByRole('button', { name: 'Get code' })).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Refresh image code' })
  ).toBeEnabled()
  expect(post).not.toHaveBeenCalled()
})

it('retries a rejected SMS with server authorization after cooldown without reusing the image', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: false,
      message: 'Delivery failed',
      data: {
        code: 'SMS_DELIVERY_FAILED',
        retry_token: 'retry-permit',
        retry_after: 1,
        retry_expires_at: Math.floor(Date.now() / 1000) + 120,
      },
    },
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
  const answer = screen.getByLabelText('Image verification code')
  await waitFor(() => expect(answer).toBeEnabled())
  await user.type(answer, '12345')
  vi.useFakeTimers()
  fireEvent.click(screen.getByRole('button', { name: 'Get code' }))
  await act(async () => vi.advanceTimersByTimeAsync(0))
  expect(screen.getByRole('alert')).toHaveTextContent('Delivery failed')
  expect(post).toHaveBeenCalledTimes(1)
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(screen.getByRole('button', { name: 'Get code' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Get code' }))
  await act(async () => vi.advanceTimersByTimeAsync(0))
  expect(post).toHaveBeenLastCalledWith(
    '/api/user/phone/change/send',
    expect.objectContaining({
      retry_token: 'retry-permit',
      captcha_token: '',
      captcha_answer: '',
    }),
    expect.any(Object)
  )
})

it('clears failed-send retry authorization when the target changes', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: false,
      message: 'Delivery failed',
      data: {
        code: 'SMS_DELIVERY_FAILED',
        retry_token: 'old-target',
        retry_after: 0,
        retry_expires_at: Math.floor(Date.now() / 1000) + 120,
      },
    },
  })
  const user = userEvent.setup()
  render(
    <PhoneChangeDialog
      open
      status={{ bound: false, phone_masked: '', verification_required: true }}
      bindingAuthorization={{
        token: 'binding',
        expires_at: Date.now() / 1000 + 600,
      }}
      onOpenChange={vi.fn()}
      onSuccess={vi.fn()}
    />
  )
  await user.type(screen.getByLabelText('New phone number'), '13900139000')
  const answer = screen.getByLabelText('Image verification code')
  await waitFor(() => expect(answer).toBeEnabled())
  await user.type(answer, '12345')
  await user.click(screen.getByRole('button', { name: 'Get code' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Delivery failed')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Get code' })).toBeEnabled()
  )
  await user.type(screen.getByLabelText('New phone number'), '{Backspace}1')
  expect(screen.getByRole('button', { name: 'Get code' })).toBeDisabled()
  expect(post).toHaveBeenCalledTimes(1)
})

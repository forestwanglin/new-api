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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { PhoneAuthForm } from '../phone-auth-form'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture() {
  let challenge = 0
  vi.spyOn(api, 'get').mockImplementation(async () => ({
    data: {
      success: true,
      data: {
        challenge_token: `captcha-${++challenge}`,
        browser_token: 'browser',
        image: 'data:image/png;base64,AA==',
      },
    },
  }))
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const content = (enabled: boolean) => (
    <QueryClientProvider client={client}>
      <PhoneAuthForm onResult={vi.fn()} enabled={enabled} />
    </QueryClientProvider>
  )
  const view = render(content(true))
  return {
    ...view,
    setEnabled: (enabled: boolean) => view.rerender(content(enabled)),
    user: userEvent.setup(),
    send: screen.getByRole('button', { name: 'Get verification code' }),
    phone: screen.getByLabelText('Phone number (mainland China +86)'),
    answer: screen.getByLabelText('Image verification code'),
  }
}
async function fill(view: ReturnType<typeof fixture>) {
  await view.user.type(view.phone, '13800138000')
  await view.user.type(view.answer, '12345')
}
it('automatically verifies complete input and enables SMS only after server success', async () => {
  const request = deferred<{
    data: { success: boolean; data: { send_token: string } }
  }>()
  const post = vi.spyOn(api, 'post').mockReturnValue(request.promise)
  const view = fixture()
  expect(
    screen.queryByRole('button', { name: 'Verify image code' })
  ).not.toBeInTheDocument()
  expect(view.send).toBeDisabled()
  await view.user.type(view.answer, '12345')
  expect(post).not.toHaveBeenCalled()
  await view.user.type(view.phone, '13800138000')
  expect(post).not.toHaveBeenCalled()
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  expect(view.send).toBeDisabled()
  await act(async () =>
    request.resolve({ data: { success: true, data: { send_token: 'permit' } } })
  )
  await waitFor(() => expect(view.send).toBeEnabled())
  await view.user.clear(view.phone)
  expect(view.send).toBeDisabled()
})
it('shows automatic verification failure once, clears the answer and refreshes without retry loops', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: false, message: 'Wrong image code' },
  })
  const view = fixture()
  await fill(view)
  expect(await screen.findByRole('alert')).toHaveTextContent('Wrong image code')
  expect(view.answer).toHaveValue('')
  expect(view.send).toBeDisabled()
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
  expect(post).toHaveBeenCalledTimes(1)
})
it.each(['phone', 'answer', 'refresh'] as const)(
  'aborts and ignores stale verification after %s changes',
  async (change) => {
    const request = deferred<{
      data: { success: boolean; data: { send_token: string } }
    }>()
    const post = vi.spyOn(api, 'post').mockReturnValue(request.promise)
    const view = fixture()
    await fill(view)
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    const signal = post.mock.calls[0]?.[2]?.signal
    if (change === 'refresh') {
      await view.user.click(
        screen.getByRole('button', { name: 'Refresh image code' })
      )
    } else await view.user.clear(view[change])
    expect(signal?.aborted).toBe(true)
    await act(async () =>
      request.resolve({
        data: { success: true, data: { send_token: 'stale' } },
      })
    )
    expect(view.send).toBeDisabled()
    expect(post).toHaveBeenCalledTimes(1)
  }
)
it('cancels an in-flight verification on close', async () => {
  const request = deferred<{
    data: { success: boolean; data: { send_token: string } }
  }>()
  const post = vi.spyOn(api, 'post').mockReturnValue(request.promise)
  const view = fixture()
  await fill(view)
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  const signal = post.mock.calls[0]?.[2]?.signal
  view.unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () =>
    request.resolve({ data: { success: true, data: { send_token: 'stale' } } })
  )
  expect(
    screen.queryByRole('button', { name: 'Get verification code' })
  ).not.toBeInTheDocument()
})

it('keeps the new challenge pending when an abandoned response arrives', async () => {
  const oldRequest = deferred<{ data: { success: boolean; message: string } }>()
  const freshRequest = deferred<{
    data: { success: boolean; data: { send_token: string } }
  }>()
  const post = vi
    .spyOn(api, 'post')
    .mockReturnValueOnce(oldRequest.promise)
    .mockReturnValueOnce(freshRequest.promise)
  const view = fixture()
  await fill(view)
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  await view.user.clear(view.phone)
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
  expect(view.answer).toHaveValue('')
  await view.user.type(view.phone, '13900139000')
  await view.user.type(view.answer, '54321')
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  await act(async () =>
    oldRequest.resolve({ data: { success: false, message: 'Stale rejection' } })
  )
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(view.send).toBeDisabled()
  expect(view.answer).toHaveValue('54321')
  expect(api.get).toHaveBeenCalledTimes(2)
  await act(async () =>
    freshRequest.resolve({
      data: { success: true, data: { send_token: 'fresh' } },
    })
  )
  await waitFor(() => expect(view.send).toBeEnabled())
})

it('cancels the debounce before a request when the form closes', async () => {
  const post = vi.spyOn(api, 'post')
  const view = fixture()
  await view.user.type(view.phone, '13800138000')
  await view.user.type(view.answer, '1234')
  vi.useFakeTimers()
  fireEvent.change(view.answer, { target: { value: '12345' } })
  view.unmount()
  await act(async () => vi.advanceTimersByTimeAsync(400))
  expect(post).not.toHaveBeenCalled()
})

it('refreshes a used challenge when agreement is re-enabled so SMS verification can resume', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { send_token: 'permit' } },
  })
  const view = fixture()
  await fill(view)
  await waitFor(() => expect(view.send).toBeEnabled())
  view.setEnabled(false)
  expect(view.send).toBeDisabled()
  view.setEnabled(true)
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
  expect(view.answer).toHaveValue('')
  await view.user.type(view.answer, '54321')
  await waitFor(() => expect(view.send).toBeEnabled())
})

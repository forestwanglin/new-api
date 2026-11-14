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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { UserPointsDialog } from '../user-points-dialog'

const clients: QueryClient[] = []
const balances = [
  {
    point_type_id: '1',
    code: 'GENERAL',
    name: 'General',
    available_points: '9007199254740993',
    frozen_points: '50',
  },
  {
    point_type_id: '99',
    code: 'FUTURE',
    name: 'Future points',
    available_points: '0',
    frozen_points: '0',
  },
]
function setup(data = balances, failed = false, pointTypeId = '1') {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 100 })
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValue({ data: { success: true, data: { balances: data } } })
  if (failed) get.mockRejectedValue(new Error('Offline'))
  const onSuccess = vi.fn()
  const onOpenChange = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  const dialog = (open: boolean, userId = 2, typeId = pointTypeId) => (
    <QueryClientProvider client={client}>
      <UserPointsDialog
        key={userId}
        open={open}
        onOpenChange={onOpenChange}
        userId={userId}
        pointTypeId={typeId}
        onSuccess={onSuccess}
      />
    </QueryClientProvider>
  )
  const view = render(dialog(true))
  return {
    get,
    onSuccess,
    onOpenChange,
    reopen: () => {
      view.rerender(dialog(false))
      view.rerender(dialog(true))
    },
    changeTarget: (userId: number, typeId = '1') =>
      view.rerender(dialog(true, userId, typeId)),
  }
}
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
})

it('opens the fixed row type and previews exact points without type selection or override', async () => {
  setup()
  expect(await screen.findByText('General (GENERAL)')).toBeVisible()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Override' })
  ).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Amount (Points)'), {
    target: { value: '2' },
  })
  expect(screen.getByRole('status')).toHaveTextContent(
    '9,007,199,254,740,993 +2 = 9,007,199,254,740,995'
  )
})

it('subtracts a future point type from zero without changing another type', async () => {
  setup(balances, false, '99')
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  await screen.findByText('Future points (FUTURE)')
  await userEvent.click(screen.getByRole('button', { name: 'Subtract' }))
  fireEvent.change(screen.getByLabelText('Amount (Points)'), {
    target: { value: '2' },
  })
  expect(screen.getByRole('status')).toHaveTextContent('0 -2 = -2')
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/user/2/points',
      expect.objectContaining({
        point_type_id: '99',
        mode: 'subtract',
        amount: '2',
      })
    )
  )
})

it.each(['0', '-1', '1.5', '1e3', '9223372036854775808'])(
  'rejects invalid point input %s before making a request',
  async (amount) => {
    setup()
    await screen.findByText('General (GENERAL)')
    const post = vi.spyOn(api, 'post')
    fireEvent.change(screen.getByLabelText('Amount (Points)'), {
      target: { value: amount },
    })
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
    expect(post).not.toHaveBeenCalled()
  }
)

it('retains a request identity after uncertain failure and refreshes only after confirmed success', async () => {
  const { onSuccess, onOpenChange } = setup()
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          ...balances[0],
          available_points: '9007199254740995',
          replayed: true,
        },
      },
    })
  await screen.findByText('General (GENERAL)')
  fireEvent.change(screen.getByLabelText('Amount (Points)'), {
    target: { value: '2' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled()
  )
  expect(screen.getByLabelText('Amount (Points)')).toHaveValue('2')
  expect(onSuccess).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
  expect(post.mock.calls[0][1]).toEqual(post.mock.calls[1][1])
  expect(post.mock.calls[0][1]).toMatchObject({
    point_type_id: '1',
    mode: 'add',
    amount: '2',
    request_id: expect.any(String),
  })
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

it('creates a new request identity when the administrator changes the amount after failure', async () => {
  setup()
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('Offline'))
  await screen.findByText('General (GENERAL)')
  fireEvent.change(screen.getByLabelText('Amount (Points)'), {
    target: { value: '2' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled()
  )
  fireEvent.change(screen.getByLabelText('Amount (Points)'), {
    target: { value: '3' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  expect(
    (post.mock.calls[0][1] as { request_id: string }).request_id
  ).not.toEqual((post.mock.calls[1][1] as { request_id: string }).request_id)
})

it('does not fabricate zero balances after loading failure and supports retry', async () => {
  const { get } = setup(balances, true)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
  )
  expect(screen.queryByLabelText('Amount (Points)')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
  get.mockResolvedValue({ data: { success: true, data: { balances } } })
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('General (GENERAL)')).toBeVisible()
})

it('disables confirmation when adding would overflow an int64 balance', async () => {
  setup([{ ...balances[0], available_points: '9223372036854775807' }])
  await screen.findByText('General (GENERAL)')
  fireEvent.change(screen.getByLabelText('Amount (Points)'), {
    target: { value: '1' },
  })
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
  expect(screen.getByRole('alert')).toBeVisible()
})

it('shows an empty configuration instead of inventing point types', async () => {
  setup([])
  expect(await screen.findByText('No point types configured')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
  expect(screen.queryByLabelText('Point type')).not.toBeInTheDocument()
})

it('locks input, cancellation and duplicate confirmation during a request', async () => {
  const { onOpenChange } = setup()
  let resolve: (value: unknown) => void = () => undefined
  const post = vi.spyOn(api, 'post').mockReturnValue(
    new Promise((done) => {
      resolve = done
    })
  )
  await screen.findByText('General (GENERAL)')
  fireEvent.change(screen.getByLabelText('Amount (Points)'), {
    target: { value: '2' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(screen.getByRole('button', { name: 'Processing...' })).toBeDisabled()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Amount (Points)')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await userEvent.keyboard('{Escape}')
  expect(onOpenChange).not.toHaveBeenCalled()
  expect(post).toHaveBeenCalledOnce()
  resolve({ data: { success: true } })
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
})

it('keeps uncertain input and request identity when closing and reopening the dialog', async () => {
  const { reopen } = setup()
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('Offline'))
  await screen.findByText('General (GENERAL)')
  fireEvent.change(screen.getByLabelText('Amount (Points)'), {
    target: { value: '2' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled()
  )
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  reopen()
  await screen.findByLabelText('Amount (Points)')
  expect(screen.getByLabelText('Amount (Points)')).toHaveValue('2')
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  expect(post.mock.calls[0][1]).toEqual(post.mock.calls[1][1])
})

it('resets an unsubmitted adjustment on cancel and loads a different target independently', async () => {
  const { get, changeTarget } = setup()
  await screen.findByText('General (GENERAL)')
  fireEvent.change(screen.getByLabelText('Amount (Points)'), {
    target: { value: '2' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByLabelText('Amount (Points)')).toHaveValue('')
  get.mockResolvedValue({
    data: {
      success: true,
      data: { balances: [{ ...balances[1], available_points: '123' }] },
    },
  })
  changeTarget(3, '99')
  await screen.findByText('Future points (FUTURE)')
  expect(get).toHaveBeenCalledWith('/api/user/3/points')
  expect(screen.queryByText('General (GENERAL)')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Available points: 123')
})

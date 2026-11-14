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
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import type { User } from '../../types'
import { UsersMutateDrawer } from '../users-mutate-drawer'
import { UsersProvider } from '../users-provider'

const target: User = {
  id: 2,
  username: 'managed-admin',
  display_name: 'Managed admin',
  role: 10,
  status: 1,
  quota: 0,
  used_quota: 0,
  request_count: 0,
  group: 'default',
}
const label = "View other accounts' audit logs"
const description =
  'View audit records from user and admin roles. Root records are always excluded.'

function renderPermissions(
  viewerRole: number,
  allowed?: boolean,
  editing = true
) {
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'operator', role: viewerRole })
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/authz/catalog') {
      return {
        data: {
          success: true,
          data: {
            resources: [
              {
                resource: 'audit',
                label_key: 'Audit Logs',
                actions: [
                  {
                    action: 'read',
                    label_key: label,
                    description_key: description,
                  },
                ],
              },
            ],
            roles: [{ key: 'admin', grants: { audit: { read: false } } }],
          },
        },
      }
    }
    if (url === '/api/user/2/points') {
      return {
        data: {
          success: true,
          data: {
            balances: [
              {
                point_type_id: '1',
                code: 'GENERAL',
                name: 'General',
                available_points: '9007199254740993',
                frozen_points: '5',
              },
              {
                point_type_id: '99',
                code: 'FUTURE',
                name: 'Future points',
                available_points: '0',
                frozen_points: '0',
              },
            ],
          },
        },
      }
    }
    if (url === '/api/group/') {
      return { data: { success: true, data: ['default'] } }
    }
    if (url === '/api/verify/methods') {
      return {
        data: {
          success: true,
          data: {
            scope: 'admin.user.update',
            methods: [{ method: '2fa', available: true }],
            oauth_providers: [],
            password_encryption_enabled: false,
          },
        },
      }
    }
    return {
      data: {
        success: true,
        data: {
          ...target,
          admin_permissions:
            allowed === undefined ? {} : { audit: { read: allowed } },
        },
      },
    }
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <UsersProvider>
        <UsersMutateDrawer
          open
          onOpenChange={() => undefined}
          currentRow={editing ? target : undefined}
        />
      </UsersProvider>
    </QueryClientProvider>
  )
  return get
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
})

it.each([undefined, true])(
  'root can save an audit grant or revocation after step-up verification (previous=%s)',
  async (allowed) => {
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        success: true,
        data: {
          proof_token: 'update-proof',
          method: '2fa',
          scope: 'admin.user.update',
          expires_at: Math.floor(Date.now() / 1000) + 60,
        },
      },
    })
    renderPermissions(100, allowed)
    await screen.findByDisplayValue('Managed admin')
    const toggle = await screen.findByRole('button', { name: label })
    await waitFor(() =>
      expect(toggle).toHaveAttribute('aria-pressed', String(!!allowed))
    )
    expect(toggle).toHaveAccessibleDescription(description)
    await userEvent.click(toggle)
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    // The permission matrix changed, so the save waits for verification.
    expect(put).not.toHaveBeenCalled()
    await userEvent.type(
      await screen.findByLabelText('Authenticator code or backup code'),
      '123456'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/api/user/',
        expect.objectContaining({
          id: 2,
          admin_permissions: { audit: { read: !allowed } },
        }),
        expect.objectContaining({
          headers: { 'X-Security-Proof': 'update-proof' },
          singleUseAuthorization: true,
        })
      )
    )
  }
)

it('root saving an administrator without changing permissions or password does not verify', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const get = renderPermissions(100, true)
  const displayName = await screen.findByDisplayValue('Managed admin')
  await userEvent.clear(displayName)
  await userEvent.type(displayName, 'Renamed admin')
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/user/',
      expect.objectContaining({ id: 2, display_name: 'Renamed admin' }),
      {}
    )
  )
  expect(put.mock.calls[0][1]).not.toHaveProperty('admin_permissions')
  expect(get).not.toHaveBeenCalledWith('/api/verify/methods', expect.anything())
})

it('admin cannot edit the audit permission even when the catalog is available', async () => {
  renderPermissions(10)
  await screen.findByDisplayValue('Managed admin')
  expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
})

it('renders every type as a readonly amount and matching adjustment button below quota', async () => {
  renderPermissions(100)
  await screen.findByDisplayValue('Managed admin')
  const quota = screen.getByRole('button', { name: 'Adjust Quota' })
  const general = await screen.findByRole('group', {
    name: 'General (GENERAL)',
  })
  const future = screen.getByRole('group', { name: 'Future points (FUTURE)' })
  expect(within(general).getByRole('textbox')).toHaveValue(
    '9,007,199,254,740,993'
  )
  expect(within(general).getByRole('textbox')).toHaveAttribute('readonly')
  expect(within(future).getByRole('textbox')).toHaveValue('0')
  expect(
    quota.compareDocumentPosition(general) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Adjust Points' })).toHaveLength(
    2
  )
  await userEvent.click(
    within(future).getByRole('button', { name: 'Adjust Points' })
  )
  const modal = await screen.findByRole('dialog', { name: 'Adjust Points' })
  await waitFor(() =>
    expect(within(modal).getByText('Future points (FUTURE)')).toBeVisible()
  )
  expect(within(modal).queryByRole('combobox')).not.toBeInTheDocument()
  expect(within(modal).queryByText('General (GENERAL)')).not.toBeInTheDocument()
})

it('does not offer quota or point adjustment when creating a user', async () => {
  renderPermissions(100, undefined, false)
  expect(
    screen.queryByRole('button', { name: 'Adjust Quota' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Adjust Points' })
  ).not.toBeInTheDocument()
})

it('refreshes a changed point row without resetting unsaved user edits', async () => {
  const get = renderPermissions(100)
  const displayName = await screen.findByDisplayValue('Managed admin')
  await userEvent.clear(displayName)
  await userEvent.type(displayName, 'Unsaved user edit')
  const future = await screen.findByRole('group', {
    name: 'Future points (FUTURE)',
  })
  await userEvent.click(
    within(future).getByRole('button', { name: 'Adjust Points' })
  )
  const modal = await screen.findByRole('dialog', { name: 'Adjust Points' })
  await within(modal).findByText('Future points (FUTURE)')
  fireEvent.change(within(modal).getByLabelText('Amount (Points)'), {
    target: { value: '2' },
  })
  const previousGet = get.getMockImplementation()
  if (!previousGet) throw new Error('Missing API fixture')
  get.mockImplementation(async (...args) => {
    if (args[0] === '/api/user/2/points') {
      return {
        data: {
          success: true,
          data: {
            balances: [
              {
                point_type_id: '99',
                code: 'FUTURE',
                name: 'Future points',
                available_points: '2',
                frozen_points: '0',
              },
            ],
          },
        },
      }
    }
    return previousGet(...args)
  })
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  await userEvent.click(within(modal).getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/user/2/points',
      expect.objectContaining({ point_type_id: '99', mode: 'add', amount: '2' })
    )
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Adjust Points' })
    ).not.toBeInTheDocument()
  )
  expect(
    within(
      screen.getByRole('group', { name: 'Future points (FUTURE)' })
    ).getByRole('textbox')
  ).toHaveValue('2')
  expect(screen.getByDisplayValue('Unsaved user edit')).toBeVisible()
})

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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { TutorialManagement } from '..'
import { TutorialGroupPicker } from '../components/group-picker'

const group = {
  id: '1',
  group_key: 'start',
  title: 'Start',
  sort_order: 0,
  enabled: true,
  version: '1',
  created_at: '1',
  updated_at: '1',
}
const chapter = {
  id: '2',
  group_id: '1',
  anchor: 'create',
  title: 'Create key',
  sort_order: 0,
  enabled: true,
  version: '5',
  created_at: '1',
  updated_at: '1',
}
function mount(children = <TutorialManagement />) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(<QueryClientProvider client={client}>{children}</QueryClientProvider>)
  return client
}
beforeEach(() => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 10 })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url.endsWith('/groups/1')) {
      return { data: { success: true, data: group } }
    }
    return {
      data: {
        success: true,
        data: url.includes('groups')
          ? { items: [group], total: 1 }
          : { items: [chapter], total: 1 },
      },
    }
  })
})
afterEach(() => useAuthStore.getState().auth.reset())
it('shows the chapter group title instead of requiring administrators to identify its numeric ID', async () => {
  mount()
  expect(await screen.findByText('Start')).toBeInTheDocument()
})
it('does not delete until confirmation and cancel leaves the chapter intact', async () => {
  const user = userEvent.setup()
  const remove = vi.spyOn(api, 'delete')
  mount()
  await screen.findByText('Create key')
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(remove).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(remove).not.toHaveBeenCalled()
  expect(screen.getByText('Create key')).toBeInTheDocument()
})
it('keeps nonempty groups visible and shows the server rejection when delete fails', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'delete').mockResolvedValue({
    data: {
      success: false,
      message: 'Tutorial group has chapters; move or delete them first',
    },
  })
  mount()
  await screen.findByText('Create key')
  await user.click(screen.getByRole('button', { name: 'Groups' }))
  await screen.findByText('Start')
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Tutorial group has chapters'
  )
  expect(screen.getByText('Start', { selector: 'span' })).toBeInTheDocument()
})
it('allows selecting groups beyond the first 100 records through directory pagination', async () => {
  const user = userEvent.setup()
  vi.mocked(api.get).mockImplementation(async (_url, config) => ({
    data: {
      success: true,
      data: {
        items: [
          {
            ...group,
            id: String((config?.params as { p: number } | undefined)?.p),
            title: `Group page ${(config?.params as { p: number } | undefined)?.p}`,
          },
        ],
        total: 120,
      },
    },
  }))
  const change = vi.fn()
  mount(<TutorialGroupPicker viewer='1' value='' onChange={change} />)
  await screen.findByRole('option', { name: 'Group page 1 (start)' })
  for (let page = 2; page <= 6; page++) {
    await user.click(
      screen.getByRole('button', { name: 'Next tutorial groups' })
    )
    await screen.findByRole('option', { name: `Group page ${page} (start)` })
  }
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Tutorial group' }),
    '6'
  )
  expect(change).toHaveBeenCalledWith('6')
  expect(
    screen.getByRole('button', { name: 'Next tutorial groups' })
  ).toBeDisabled()
})

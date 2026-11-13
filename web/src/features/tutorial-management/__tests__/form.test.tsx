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
import { expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { TutorialForm } from '../components/tutorial-form'

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
  content_markdown: 'Original text',
  sort_order: 0,
  enabled: true,
  version: '5',
  created_at: '1',
  updated_at: '1',
}
function mount(
  entity: 'groups' | 'chapters',
  item?: typeof group | typeof chapter
) {
  const onClose = vi.fn()
  const onSaved = vi.fn().mockResolvedValue(undefined)
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <TutorialForm
        entity={entity}
        viewer='1'
        item={item}
        onClose={onClose}
        onSaved={onSaved}
      />
    </QueryClientProvider>
  )
  return { onClose, onSaved }
}
it('keeps a failed chapter draft and its initial version when the server rejects a stale save', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { items: [group], total: 1 } },
  })
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: false,
      message: 'Tutorial was changed. Reload before saving.',
    },
  })
  const { onClose, onSaved } = mount('chapters', chapter)
  const content = await screen.findByRole('textbox', {
    name: 'Markdown content',
  })
  await user.clear(content)
  await user.type(content, 'My unsaved draft')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByRole('alert')
  expect(content).toHaveValue('My unsaved draft')
  expect(onClose).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
  expect(put).toHaveBeenCalledWith(
    '/api/config_tutorial/admin/chapters/2',
    expect.objectContaining({
      version: '5',
      content_markdown: 'My unsaved draft',
    })
  )
})
it('creates a group with disabled zero-sort values and closes only after persistence succeeds', async () => {
  const user = userEvent.setup()
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: group } })
  const { onClose, onSaved } = mount('groups')
  await user.type(screen.getByRole('textbox', { name: 'Group key' }), 'start')
  await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Start')
  await user.click(screen.getByRole('switch', { name: 'Enabled' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(onSaved).toHaveBeenCalled()
  expect(post).toHaveBeenCalledWith('/api/config_tutorial/admin/groups', {
    group_key: 'start',
    title: 'Start',
    sort_order: 0,
    enabled: false,
  })
})

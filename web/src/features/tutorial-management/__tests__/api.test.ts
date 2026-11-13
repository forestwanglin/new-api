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
import { describe, expect, it, vi } from 'vitest'

import { getPublicTutorial } from '@/features/config-tutorial/api'
import { api } from '@/lib/api'

import {
  listTutorialGroups,
  saveTutorialGroup,
  saveTutorialChapter,
  deleteTutorialItem,
} from '../api'

describe('tutorial API contracts', () => {
  it('updates a chapter with version and editable fields only, preserving false and zero', async () => {
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true, data: {} } })
    await saveTutorialChapter(
      {
        group_id: '9007199254740993',
        anchor: 'old-anchor',
        title: 'Changed',
        content_markdown: '**Text**',
        sort_order: 0,
        enabled: false,
      },
      { id: '2', version: '7' }
    )
    expect(put).toHaveBeenCalledWith('/api/config_tutorial/admin/chapters/2', {
      group_id: '9007199254740993',
      title: 'Changed',
      content_markdown: '**Text**',
      sort_order: 0,
      enabled: false,
      version: '7',
    })
  })
  it('sends group keys only on creation and does not resend immutable keys on update', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true, data: {} } })
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true, data: {} } })
    const input = {
      group_key: 'start',
      title: 'Start',
      sort_order: 0,
      enabled: true,
    }
    await saveTutorialGroup(input)
    await saveTutorialGroup(input, { id: '1', version: '2' })
    expect(post).toHaveBeenCalledWith(
      '/api/config_tutorial/admin/groups',
      input
    )
    expect(put).toHaveBeenCalledWith('/api/config_tutorial/admin/groups/1', {
      title: 'Start',
      sort_order: 0,
      enabled: true,
      version: '2',
    })
  })
  it('propagates business failures instead of returning fake success or empty content', async () => {
    const failure = {
      data: { success: false, message: 'Tutorial unavailable' },
    }
    vi.spyOn(api, 'get').mockResolvedValue(failure)
    vi.spyOn(api, 'delete').mockResolvedValue(failure)
    await expect(getPublicTutorial()).rejects.toThrow('Tutorial unavailable')
    await expect(listTutorialGroups({ p: 1, page_size: 20 })).rejects.toThrow(
      'Tutorial unavailable'
    )
    await expect(deleteTutorialItem('groups', '1')).rejects.toThrow(
      'Tutorial unavailable'
    )
  })
})

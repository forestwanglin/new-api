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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { OfficialWeChatConfirmation } from '../confirmation'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
afterEach(() => vi.restoreAllMocks())
it('shows explicit binding intent and sends only scanner confirmation when cancelled', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        intent: 'bind',
        site_name: 'Example',
        csrf_token: 'scanner-csrf',
        expires_at: Math.floor(Date.now() / 1000) + 60,
      },
    },
  })
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { same_device: false } },
  })
  render(<OfficialWeChatConfirmation />)
  await screen.findByText('Bind WeChat')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await screen.findByText('Cancelled')
  expect(post).toHaveBeenCalledWith(
    '/api/oauth/wechat_official/confirm',
    { csrf_token: 'scanner-csrf', confirmed: false },
    expect.not.objectContaining({ singleUseAuthorization: true })
  )
  expect(post.mock.calls.some(([url]) => url.endsWith('/complete'))).toBe(false)
})
it('does not show confirm controls if scanner confirmation cannot be loaded', async () => {
  vi.spyOn(api, 'get').mockRejectedValue(new Error('scanner expired'))
  const post = vi.spyOn(api, 'post')
  render(<OfficialWeChatConfirmation />)
  await waitFor(() => expect(screen.getByRole('alert')).toBeVisible())
  expect(
    screen.queryByRole('button', { name: 'Confirm authorization' })
  ).not.toBeInTheDocument()
  expect(post).not.toHaveBeenCalled()
})

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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { TutorialContent } from '../components/tutorial-content'

afterEach(cleanup)
it('sanitizes malicious links and event attributes while rendering tables and emphasis', () => {
  const view = render(
    <TutorialContent
      content={
        '**Important**\n\n| A | B |\n| - | - |\n| one | two |\n\n<script>alert(1)</script><img src="x" onerror="alert(1)">[bad](javascript:alert(1))'
      }
    />
  )
  expect(screen.getByText('Important').tagName).toBe('STRONG')
  expect(screen.getByRole('table')).toBeInTheDocument()
  expect(view.container.querySelector('script')).toBeNull()
  expect(view.container.querySelector('[onerror]')).toBeNull()
  expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull()
})
it('copies fenced code as text and refreshes copy controls when Markdown changes', async () => {
  const user = userEvent.setup()
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  const view = render(
    <TutorialContent content={'```sh\ncurl "https://example.com"\n```'} />
  )
  await user.click(await screen.findByRole('button', { name: 'Copy code' }))
  expect(write).toHaveBeenCalledWith('curl "https://example.com"\n')
  view.rerender(<TutorialContent content='No code now' />)
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Copy code' })
    ).not.toBeInTheDocument()
  )
})

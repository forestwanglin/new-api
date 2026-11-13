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
import { beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { ConfigTutorial } from '..'

vi.mock('@/components/layout', () => ({
  PublicLayout: (props: { children: React.ReactNode }) => (
    <div>{props.children}</div>
  ),
}))
const document = {
  groups: [
    {
      group_key: 'start',
      title: 'Getting started',
      chapters: [
        {
          id: '1',
          anchor: 'create',
          title: 'Create key',
          content_markdown: '**First chapter**',
        },
        {
          id: '2',
          anchor: 'connect',
          title: 'Connect application',
          content_markdown: 'Second chapter',
        },
      ],
    },
  ],
}
function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ConfigTutorial />
    </QueryClientProvider>
  )
}
beforeEach(() => {
  window.location.hash = ''
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: document },
  })
})
it('reads every chapter anonymously and follows a chapter hash after async loading', async () => {
  window.location.hash = '#connect'
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
  mount()
  expect(
    await screen.findByRole('navigation', { name: 'Tutorial contents' })
  ).toBeInTheDocument()
  expect(screen.getByText('First chapter')).toBeInTheDocument()
  expect(screen.getByText('Second chapter')).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'Connect application' })
  ).toHaveAttribute('aria-current', 'location')
  expect(scroll).toHaveBeenCalledWith({ block: 'start' })
  expect(api.get).toHaveBeenCalledWith('/api/config_tutorial')
})
it('keeps empty and failed content distinct and retries the failed request', async () => {
  const get = vi.mocked(api.get)
  get
    .mockResolvedValueOnce({ data: { success: false, message: 'Unavailable' } })
    .mockResolvedValueOnce({ data: { success: true, data: { groups: [] } } })
  mount()
  await screen.findByText('Unavailable')
  expect(screen.queryByText('No tutorials available')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('No tutorials available')).toBeInTheDocument()
})
it('updates selection on browser hash navigation and ignores unknown anchors', async () => {
  mount()
  await screen.findByText('Second chapter')
  window.location.hash = '#connect'
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  await waitFor(() =>
    expect(
      screen.getByRole('link', { name: 'Connect application' })
    ).toHaveAttribute('aria-current', 'location')
  )
  window.location.hash = '#missing'
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  await waitFor(() =>
    expect(screen.getByRole('link', { name: 'Create key' })).toHaveAttribute(
      'aria-current',
      'location'
    )
  )
})
it.each([
  ['Getting started', 'create'],
  ['Connect application', 'connect'],
])(
  'scrolls back to %s when its hash is already selected',
  async (name, anchor) => {
    window.location.hash = `#${anchor}`
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    mount()
    const link = await screen.findByRole('link', { name })
    await waitFor(() => expect(scroll).toHaveBeenCalled())
    scroll.mockClear()
    await userEvent.click(link)
    expect(scroll).toHaveBeenCalledWith({ block: 'start' })
  }
)

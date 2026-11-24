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
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { AgreementConsent, type AgreementKind } from '../agreement-consent'

afterEach(() => vi.restoreAllMocks())
function Fixture(props: { kind: AgreementKind }) {
  const [checked, setChecked] = useState(false)
  return (
    <AgreementConsent
      documents={[props.kind]}
      checked={checked}
      onCheckedChange={setChecked}
    />
  )
}
function mount(kind: AgreementKind = 'subscription') {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Fixture kind={kind} />
    </QueryClientProvider>
  )
}
it('reads Markdown in a dialog without changing consent and restores the underlying checkbox', async () => {
  const user = userEvent.setup()
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: '# Service terms\n\n**Important** <script>dangerous()</script>',
    },
  })
  mount()
  expect(get).not.toHaveBeenCalled()
  await user.click(
    screen.getByRole('button', {
      name: 'Personal Subscription Service Agreement',
    })
  )
  expect(
    await screen.findByRole('heading', { name: 'Service terms' })
  ).toBeVisible()
  expect(document.querySelector('script')).toBeNull()
  expect(get).toHaveBeenCalledWith(
    '/api/subscription-agreement',
    expect.objectContaining({ skipAuthRefresh: true })
  )
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await user.click(screen.getByRole('checkbox'))
  expect(screen.getByRole('checkbox')).toBeChecked()
})
it('shows a retryable error when document reading fails instead of an empty agreement', async () => {
  const user = userEvent.setup()
  const get = vi
    .spyOn(api, 'get')
    .mockRejectedValueOnce(new Error('Document unavailable'))
    .mockResolvedValueOnce({
      data: { success: true, data: '# Recovered document' },
    })
  mount()
  await user.click(
    screen.getByRole('button', {
      name: 'Personal Subscription Service Agreement',
    })
  )
  expect(await screen.findByText('Document unavailable')).toBeVisible()
  expect(
    screen.queryByText(
      'The administrator has not configured this agreement yet.'
    )
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(
    await screen.findByRole('heading', { name: 'Recovered document' })
  ).toBeVisible()
  expect(get).toHaveBeenCalledTimes(2)
})
it('shows an explicit empty document state after a successful blank response', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: '  ' },
  })
  mount()
  await userEvent.click(
    screen.getByRole('button', {
      name: 'Personal Subscription Service Agreement',
    })
  )
  expect(
    await screen.findByText(
      'The administrator has not configured this agreement yet.'
    )
  ).toBeVisible()
})
it('preserves external URL user agreements without navigating away from the login form', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: 'https://example.test/terms' },
  })
  mount('user')
  await userEvent.click(screen.getByRole('button', { name: 'User Agreement' }))
  expect(
    await screen.findByRole('link', { name: 'View document' })
  ).toHaveAttribute('href', 'https://example.test/terms')
  expect(screen.getByRole('dialog', { name: 'User Agreement' })).toBeVisible()
})

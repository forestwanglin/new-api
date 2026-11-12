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
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { SubscriptionDemo } from '..'

vi.mock('@/components/layout', () => ({
  PublicLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
afterEach(cleanup)
it('shows six offers, exact annual points and all rules', () => {
  render(<SubscriptionDemo />)
  expect(screen.getAllByRole('article')).toHaveLength(6)
  expect(screen.getByText('2,388,000')).toBeVisible()
  expect(
    screen.getByRole('heading', { name: 'Subscription rules' })
  ).toBeVisible()
})
it('requires consent, simulates one renewal selection and never claims payment', async () => {
  const user = userEvent.setup()
  render(<SubscriptionDemo />)
  await user.click(screen.getAllByRole('switch')[0])
  const dialog = screen.getByRole('dialog')
  expect(
    within(dialog).getByRole('button', { name: 'Confirm demo' })
  ).toBeDisabled()
  await user.click(within(dialog).getByRole('checkbox'))
  await user.click(within(dialog).getByRole('button', { name: 'Confirm demo' }))
  expect(screen.getAllByRole('switch')[0]).toHaveAttribute(
    'aria-checked',
    'true'
  )
  expect(screen.getByRole('status')).toHaveTextContent(
    'No payment or subscription has been made.'
  )
})
it('replaces renewal selections, supports cancellation and resets on remount', async () => {
  const user = userEvent.setup()
  const view = render(<SubscriptionDemo />)
  for (const index of [0, 1]) {
    await user.click(screen.getAllByRole('switch')[index])
    await user.click(within(screen.getByRole('dialog')).getByRole('checkbox'))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Confirm demo',
      })
    )
  }
  expect(
    screen
      .getAllByRole('switch')
      .filter((el) => el.getAttribute('aria-checked') === 'true')
  ).toHaveLength(1)
  expect(screen.getAllByRole('switch')[0]).toHaveAttribute(
    'aria-checked',
    'false'
  )
  await user.click(screen.getAllByRole('switch')[1])
  expect(screen.getAllByRole('switch')[1]).toHaveAttribute(
    'aria-checked',
    'false'
  )
  view.unmount()
  render(<SubscriptionDemo />)
  expect(
    screen
      .getAllByRole('switch')
      .every((el) => el.getAttribute('aria-checked') === 'false')
  ).toBe(true)
})
it('cancels a purchase with Escape without enabling renewal', async () => {
  const user = userEvent.setup()
  render(<SubscriptionDemo />)
  await user.click(screen.getAllByRole('switch')[0])
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getAllByRole('switch')[0]).toHaveAttribute(
    'aria-checked',
    'false'
  )
})
it('shows demo empty states rather than account records', async () => {
  const user = userEvent.setup()
  render(<SubscriptionDemo />)
  await user.click(screen.getByRole('tab', { name: 'Orders' }))
  expect(screen.getByText('No demo subscription orders.')).toBeVisible()
})

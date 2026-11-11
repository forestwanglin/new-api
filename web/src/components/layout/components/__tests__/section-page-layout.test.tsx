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
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it } from 'vitest'

import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { PageFooterPortal } from '../page-footer'
import { SectionPageLayout } from '../section-page-layout'

afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.setUser(null)
})

function Page(props: { variant?: 'default' | 'user'; fixedContent?: boolean }) {
  return (
    <SectionPageLayout
      variant={props.variant}
      fixedContent={props.fixedContent}
    >
      <SectionPageLayout.Title>A long page title</SectionPageLayout.Title>
      <SectionPageLayout.Description>
        Page instructions
      </SectionPageLayout.Description>
      <SectionPageLayout.Actions>
        <button type='button'>Primary action</button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <p>Page content</p>
        <PageFooterPortal>
          <button type='button'>Next page</button>
        </PageFooterPortal>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

it('keeps the default layout even for an ordinary user unless explicitly opted in', () => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'user', role: ROLE.USER })
  render(<Page />)
  expect(screen.getByRole('main')).not.toHaveClass('user-page')
  expect(screen.getByRole('heading')).toHaveClass('truncate')
  expect(screen.getByRole('button', { name: 'Next page' })).toBeVisible()
})

it('opts ordinary users into a wrapping title and includes instructions and pagination in the page scope', () => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'user', role: ROLE.USER })
  render(<Page variant='user' fixedContent />)
  const main = screen.getByRole('main')
  expect(main).toHaveClass('user-page')
  expect(screen.getByRole('heading')).not.toHaveClass('truncate')
  expect(screen.getByText('Page instructions')).toBeVisible()
  expect(main).toContainElement(
    screen.getByRole('button', { name: 'Next page' })
  )
  expect(screen.getByText('Page content').parentElement).toHaveClass(
    'overflow-hidden'
  )
  expect(
    screen.getByRole('button', { name: 'Primary action' }).parentElement
  ).toHaveClass('flex-wrap')
})

it.each([ROLE.GUEST, ROLE.ADMIN, ROLE.SUPER_ADMIN])(
  'keeps role %s on the original layout even when a user variant is requested',
  (role) => {
    useAuthStore.getState().auth.setUser({ id: 1, username: 'viewer', role })
    render(<Page variant='user' />)
    expect(screen.getByRole('main')).not.toHaveClass('user-page')
    expect(screen.getByRole('heading')).toHaveClass('truncate')
  }
)

it('keeps keyboard navigation to the action and the portaled pagination', async () => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'user', role: ROLE.USER })
  render(<Page variant='user' fixedContent />)
  const user = userEvent.setup()
  await user.tab()
  expect(screen.getByRole('button', { name: 'Primary action' })).toHaveFocus()
  await user.tab()
  expect(screen.getByRole('button', { name: 'Next page' })).toHaveFocus()
})

it('removes the user appearance immediately when the account changes to an administrator', () => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'user', role: ROLE.USER })
  const view = render(<Page variant='user' />)
  useAuthStore
    .getState()
    .auth.setUser({ id: 2, username: 'admin', role: ROLE.ADMIN })
  view.rerender(<Page variant='user' />)
  expect(screen.getByRole('main')).not.toHaveClass('user-page')
})

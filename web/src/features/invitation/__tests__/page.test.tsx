import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'

import { InvitationPage } from '..'
import { readBindingIntent } from '../intent'

vi.mock('@/components/layout', () => ({
  SectionPageLayout: Object.assign(
    ({ children }: { children: ReactNode }) => <main>{children}</main>,
    {
      Title: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
      Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    }
  ),
}))
const empty = { page: 1, page_size: 20, total: '0', items: [] }
let bound = false
beforeEach(() => {
  sessionStorage.clear()
  useAuthStore.getState().auth.reset()
  useLoginModalStore.getState().close()
  bound = false
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    let data: unknown = empty
    if (url.endsWith('/current')) data = null
    if (url.endsWith('/summary')) {
      data = {
        bound_friends: '0',
        effective_friends: '0',
        pending_friends: '0',
        current_rate_bps: null,
        next_threshold: null,
        balances: [],
      }
    }
    if (url.endsWith('/link')) {
      data = { code: 'forest', url: 'https://example.com/invite?aff=forest' }
    }
    if (url.endsWith('/binding')) {
      data = {
        bound,
        inviter_label: 'F***',
        inviter_code: 'forest',
        bound_at: null,
      }
    }
    return { data: { success: true, data } }
  })
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: {
        bound: true,
        inviter_label: 'F***',
        inviter_code: 'forest',
        bound_at: null,
      },
    },
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <InvitationPage />
    </QueryClientProvider>
  )
}
function login() {
  useAuthStore.getState().auth.setBundle({
    user: { id: 1, username: 'u', role: 1 },
    access_token: 'token',
    token_type: 'Bearer',
    access_expires_at: 9999999999,
    session: {
      sid: 's',
      current: true,
      login_method: 'phone',
      ip: '',
      user_agent: '',
      created_at: 0,
      last_active_at: 0,
      expires_at: 9999999999,
    },
  })
}
it('anonymous confirm opens login and never binds on login failure or cancellation', async () => {
  mount()
  await userEvent.type(screen.getByRole('textbox'), 'forest')
  await userEvent.click(screen.getByRole('button', { name: 'Confirm binding' }))
  expect(useLoginModalStore.getState().isOpen).toBe(true)
  expect(readBindingIntent()).toBe('forest')
  expect(api.post).not.toHaveBeenCalled()
  act(() => useLoginModalStore.getState().close())
  await waitFor(() => expect(readBindingIntent()).toBe(''))
  expect(api.post).not.toHaveBeenCalled()
})
it('requires explicit confirmation after complete authentication', async () => {
  mount()
  await userEvent.type(screen.getByRole('textbox'), 'forest')
  await userEvent.click(screen.getByRole('button', { name: 'Confirm binding' }))
  act(() => login())
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Confirm binding' })
    ).toBeEnabled()
  )
  expect(api.post).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Confirm binding' }))
  await userEvent.click(
    await screen.findByRole('button', { name: 'Bind permanently' })
  )
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/api/invitation/self/binding',
      expect.objectContaining({
        invitation: 'forest',
        request_id: expect.any(String),
      })
    )
  )
})
it('does not use a partial MFA identity to bind and shows existing binding dialog', async () => {
  act(() =>
    useAuthStore
      .getState()
      .auth.setUser({ id: 1, username: 'partial', role: 1 })
  )
  mount()
  await userEvent.type(screen.getByRole('textbox'), 'forest')
  await userEvent.click(screen.getByRole('button', { name: 'Confirm binding' }))
  expect(api.post).not.toHaveBeenCalled()
  bound = true
  act(() => login())
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Confirm binding' })
    ).toBeEnabled()
  )
  await userEvent.click(screen.getByRole('button', { name: 'Confirm binding' }))
  expect(await screen.findByRole('dialog')).toHaveTextContent(
    'You have already bound an inviter'
  )
  expect(api.post).not.toHaveBeenCalled()
})
it('clears binding input on account switch', async () => {
  login()
  mount()
  await userEvent.type(screen.getByRole('textbox'), 'forest')
  act(() =>
    useAuthStore.getState().auth.setUser({ id: 2, username: 'other', role: 1 })
  )
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''))
})

it('backend already-bound race opens the immutable binding dialog', async () => {
  login()
  vi.mocked(api.post).mockResolvedValue({
    data: {
      success: false,
      code: 'ALREADY_BOUND',
      message: 'An inviter has already been bound',
    },
  })
  mount()
  await userEvent.type(screen.getByRole('textbox'), 'forest')
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Confirm binding' })
    ).toBeEnabled()
  )
  await userEvent.click(screen.getByRole('button', { name: 'Confirm binding' }))
  await userEvent.click(
    await screen.findByRole('button', { name: 'Bind permanently' })
  )
  await waitFor(() =>
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'You have already bound an inviter'
    )
  )
})

it('already-bound account without a URL code can open its binding dialog', async () => {
  bound = true
  login()
  mount()
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Confirm binding' })
    ).toBeEnabled()
  )
  expect(screen.getByRole('textbox')).toHaveAttribute('readonly')
  await userEvent.click(screen.getByRole('button', { name: 'Confirm binding' }))
  expect(await screen.findByRole('dialog')).toHaveTextContent(
    'You have already bound an inviter'
  )
  expect(api.post).not.toHaveBeenCalled()
})

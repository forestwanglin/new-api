import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'

import { InvitationPage } from '..'
import { InvitationCampaignAdmin } from '../admin'
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
let inviterAvatar = ''
beforeEach(() => {
  sessionStorage.clear()
  useAuthStore.getState().auth.reset()
  useLoginModalStore.getState().close()
  bound = false
  inviterAvatar = ''
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
        inviter_name: 'Forest昵称',
        inviter_avatar_url: inviterAvatar,
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
  vi.unstubAllGlobals()
})
function mount(page: ReactNode = <InvitationPage />) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>{page}</QueryClientProvider>
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
it('shows the bound inviter nickname and avatar fallback', async () => {
  bound = true
  login()
  mount()
  expect(await screen.findByText('Forest昵称')).toBeVisible()
  expect(
    screen.getByText('F', { selector: '[data-slot="avatar-fallback"]' })
  ).toBeVisible()
})
it('shows the bound inviter avatar after the image loads', async () => {
  const images: HTMLImageElement[] = []
  const OriginalImage = window.Image
  vi.stubGlobal(
    'Image',
    class extends OriginalImage {
      constructor() {
        super()
        images.push(this)
      }
    }
  )
  bound = true
  inviterAvatar = 'https://example.com/inviter.png'
  login()
  mount()
  await waitFor(() => expect(images.length).toBeGreaterThan(0))
  await act(async () => {
    for (const image of images) image.dispatchEvent(new Event('load'))
  })
  expect(
    await screen.findByRole('img', { name: 'Forest昵称' })
  ).toHaveAttribute('src', inviterAvatar)
})
it.each([
  { endsAt: '2', expired: true },
  { endsAt: '4102444800000', expired: false },
])(
  'past-start draft with end $endsAt warns only when expired=$expired',
  async ({ endsAt, expired }) => {
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: {
        success: true,
        data:
          url === '/api/points/types'
            ? []
            : {
                ...empty,
                total: '1',
                items: [
                  {
                    id: '1',
                    code: 'past',
                    period: 1,
                    name: 'Past campaign',
                    description: '',
                    starts_at: '1',
                    ends_at: endsAt,
                    reward_point_type_id: '1',
                    reward_point_type: {
                      id: '1',
                      code: 'GENERAL',
                      name: 'General',
                    },
                    freeze_days: 7,
                    tiers: [],
                    rules_text: '',
                    visible: true,
                    status: 'draft',
                    version: '1',
                  },
                ],
              },
      },
    }))
    mount(<InvitationCampaignAdmin />)
    await screen.findByText(
      `${new Date(1).toLocaleString()} – ${new Date(Number(endsAt)).toLocaleString()}`
    )
    const warning = screen.queryByText(
      'Campaign end time has passed. Set a future end time.'
    )
    if (expired) {
      expect(warning).toBeVisible()
    } else {
      expect(warning).not.toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled()
  }
)
it('visibility checkbox has a label and toggles with pointer and keyboard', async () => {
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: { success: true, data: url === '/api/points/types' ? [] : empty },
  }))
  mount(<InvitationCampaignAdmin />)
  await userEvent.click(screen.getByRole('button', { name: 'New campaign' }))
  const checkbox = screen.getByRole('checkbox', { name: 'Visible' })
  expect(checkbox).toBeChecked()
  await userEvent.click(within(screen.getByRole('dialog')).getByText('Visible'))
  expect(checkbox).not.toBeChecked()
  checkbox.focus()
  await userEvent.keyboard('[Space]')
  expect(checkbox).toBeChecked()
})
it('shows labeled campaign fields with paired dates and reward type before tiers', async () => {
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/points/types'
          ? [{ id: 1, name: 'General', code: 'general' }]
          : empty,
    },
  }))
  mount(<InvitationCampaignAdmin />)

  await userEvent.click(screen.getByRole('button', { name: 'New campaign' }))
  for (const label of [
    'Campaign code',
    'Campaign period',
    'Campaign name',
    'Freeze days',
    'Starts at',
    'Ends at',
    'Description',
    'Campaign rules',
    'Reward point type',
    'Minimum effective friends',
    'Reward basis points',
  ]) {
    const field = screen.getAllByLabelText(label)[0]
    const visibleLabel = [...screen.getAllByText(label)].find((element) =>
      element.closest('label')?.contains(field)
    )
    expect(visibleLabel).toBeDefined()
    if (!visibleLabel) throw new Error(`Visible label is missing: ${label}`)
    expect(field).toBeVisible()
    expect(visibleLabel).toBeVisible()
    expect(
      visibleLabel.compareDocumentPosition(field) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  }

  const startsAt = screen.getByLabelText('Starts at')
  const endsAt = screen.getByLabelText('Ends at')
  const fields = startsAt.closest('[data-slot="campaign-fields"]')
  expect(fields).not.toBeNull()
  if (!fields) throw new Error('Campaign fields container is missing')
  expect(fields).toContainElement(endsAt)
  const labels = [...fields.querySelectorAll('label')]
  const startsLabel = startsAt.closest('label')
  const endsLabel = endsAt.closest('label')
  if (
    !(
      startsLabel instanceof HTMLLabelElement &&
      endsLabel instanceof HTMLLabelElement
    )
  ) {
    throw new Error('Campaign date labels are missing')
  }
  expect(labels.indexOf(startsLabel) + 1).toBe(labels.indexOf(endsLabel))
  expect(fields).toHaveClass('sm:grid-cols-2')

  const pointTypeLabel = screen
    .getByLabelText('Reward point type')
    .closest('label')
  const firstTierLabel = screen
    .getAllByLabelText('Minimum effective friends')[0]
    .closest('label')
  if (
    !(
      pointTypeLabel instanceof HTMLLabelElement &&
      firstTierLabel instanceof HTMLLabelElement
    )
  ) {
    throw new Error('Reward type and tier labels are missing')
  }
  expect(
    pointTypeLabel.compareDocumentPosition(firstTierLabel) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
})
it('anonymous confirm opens login and never binds on login failure or cancellation', async () => {
  mount(<InvitationPage initialInvitation='forest' />)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  await userEvent.click(
    await screen.findByRole('button', {
      name: 'Sign in to get your invitation link',
    })
  )
  expect(useLoginModalStore.getState().isOpen).toBe(true)
  expect(readBindingIntent()).toBe('forest')
  expect(api.post).not.toHaveBeenCalled()
  act(() => useLoginModalStore.getState().close())
  await waitFor(() => expect(readBindingIntent()).toBe(''))
  expect(api.post).not.toHaveBeenCalled()
})
it('requires explicit confirmation after complete authentication', async () => {
  mount(<InvitationPage initialInvitation='forest' />)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  await userEvent.click(
    await screen.findByRole('button', {
      name: 'Sign in to get your invitation link',
    })
  )
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
it('does not use a partial MFA identity to bind and shows the inviter after full login', async () => {
  act(() =>
    useAuthStore
      .getState()
      .auth.setUser({ id: 1, username: 'partial', role: 1 })
  )
  mount(<InvitationPage initialInvitation='forest' />)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  await userEvent.click(
    await screen.findByRole('button', {
      name: 'Sign in to get your invitation link',
    })
  )
  expect(api.post).not.toHaveBeenCalled()
  bound = true
  act(() => login())
  expect(await screen.findByText('Forest昵称')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'View binding' })
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

it('backend already-bound race shows the error inline and refreshes inviter details', async () => {
  login()
  vi.mocked(api.post).mockImplementation(async () => {
    bound = true
    return {
      data: {
        success: false,
        code: 'ALREADY_BOUND',
        message: 'An inviter has already been bound',
      },
    }
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
  expect(await screen.findByRole('status')).toHaveTextContent(
    'An inviter has already been bound'
  )
  expect(await screen.findByText('Forest昵称')).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('shows only the bound label, avatar and nickname in that order', async () => {
  bound = true
  login()
  mount()
  const name = await screen.findByText('Forest昵称')
  const label = screen.getByText('Bound inviter:')
  const avatar = screen.getByText('F', {
    selector: '[data-slot="avatar-fallback"]',
  })
  expect(
    label.compareDocumentPosition(avatar) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(
    avatar.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  const inviterSection = screen
    .getByRole('heading', { name: 'My inviter' })
    .closest('section')
  if (!inviterSection) throw new Error('Inviter section is missing')
  expect(within(inviterSection).queryByText('forest')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'View binding' })
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('invalid tier input keeps the admin preview usable and prevents saving', async () => {
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/points/types'
          ? [{ id: 1, name: 'General', code: 'general' }]
          : empty,
    },
  }))
  mount(<InvitationCampaignAdmin />)
  await userEvent.click(screen.getByRole('button', { name: 'New campaign' }))
  await userEvent.type(screen.getByLabelText('Campaign code'), 'test')
  await userEvent.type(screen.getByLabelText('Campaign name'), 'Test campaign')
  await userEvent.click(
    screen.getByRole('combobox', { name: 'Reward point type' })
  )
  await userEvent.click(
    await screen.findByRole('option', { name: 'General (general)' })
  )
  fireEvent.change(screen.getByLabelText('Starts at'), {
    target: { value: '2026-11-16T00:00' },
  })
  fireEvent.change(screen.getByLabelText('Ends at'), {
    target: { value: '2026-12-16T00:00' },
  })
  const rate = screen.getAllByLabelText('Reward basis points')[0]
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  )
  for (const invalid of ['500.5', '10001', '-1']) {
    fireEvent.change(rate, { target: { value: invalid } })
    expect(screen.getByText(/Reward preview for CNY 100/)).toHaveTextContent(
      '0+: -'
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    )
  }
  fireEvent.change(rate, { target: { value: '700' } })
  expect(screen.getByText(/Reward preview for CNY 100/)).toHaveTextContent(
    '0+: 7000'
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  )
  expect(api.post).not.toHaveBeenCalled()
})

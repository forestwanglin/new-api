import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'

import { InvitationPage } from '..'

const campaign = {
  id: '1',
  code: 'autumn',
  period: 4,
  name: 'Autumn invitation',
  description: '',
  starts_at: '1794000000000',
  ends_at: '1796000000000',
  reward_point_type_id: '2',
  reward_point_type: { id: '2', code: 'CLAUDE', name: 'Claude credits' },
  freeze_days: 14,
  tiers: [
    { min_effective_friends: 0, rate_bps: 250 },
    { min_effective_friends: 5, rate_bps: 825 },
  ],
  rules_text: 'Additional configured rules',
  visible: true,
  status: 'active',
  version: '1',
}
beforeEach(() => {
  useAuthStore.getState().auth.reset()
  useLoginModalStore.getState().close()
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/current')
        ? campaign
        : { page: 1, page_size: 20, total: '1', items: [campaign] },
    },
  }))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <InvitationPage />
    </QueryClientProvider>
  )
}
it('anonymous page shows configured tiers and rules while hiding all private modules', async () => {
  mount()
  expect(
    await screen.findByRole('heading', {
      name: 'Invite friends and earn points',
    })
  ).toBeVisible()
  expect(await screen.findByText('0—4 friends')).toBeVisible()
  expect(screen.getAllByText('5+ friends').length).toBeGreaterThan(0)
  expect(screen.getAllByText('Claude credits').length).toBeGreaterThan(0)
  expect(screen.getByText(/2,500 \/ 8,250/)).toBeVisible()
  expect(screen.getByText('Additional configured rules')).toBeVisible()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Sign in to get your invitation link' })
  )
  expect(useLoginModalStore.getState().isOpen).toBe(true)
})
it('applies progressive color and meter positions to every rendered tier', async () => {
  const fiveTierCampaign = {
    ...campaign,
    tiers: [
      { min_effective_friends: 0, rate_bps: 250 },
      { min_effective_friends: 2, rate_bps: 400 },
      { min_effective_friends: 4, rate_bps: 550 },
      { min_effective_friends: 6, rate_bps: 700 },
      { min_effective_friends: 8, rate_bps: 850 },
    ],
  }
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/current')
        ? fiveTierCampaign
        : { page: 1, page_size: 20, total: '1', items: [fiveTierCampaign] },
    },
  }))

  const { container } = mount()
  await screen.findByText('0—1 friends')
  const tiers = [...container.querySelectorAll<HTMLElement>('.iv-tier')]
  expect(tiers).toHaveLength(5)
  expect(
    tiers.map((tier) => tier.style.getPropertyValue('--tier-progress'))
  ).toEqual(['0%', '25%', '50%', '75%', '100%'])
  expect(
    tiers.map((tier) => tier.style.getPropertyValue('--tier-height'))
  ).toEqual(['6px', '9px', '12px', '15px', '18px'])
})
it('all activities opens a dialog with actual tiers and closes with Escape', async () => {
  mount()
  await userEvent.click(
    await screen.findByRole('button', { name: 'All activities' })
  )
  const dialog = await screen.findByRole('dialog')
  expect(await within(dialog).findByText('Autumn invitation')).toBeVisible()
  expect(within(dialog).getByText('8.25%')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'All activities' })).toHaveFocus()
})

it('reads every public page before choosing the latest ten activities', async () => {
  const { getLatestCampaigns } = await import('../api')
  const first = Array.from({ length: 20 }, (_, index) => ({
    ...campaign,
    id: String(30 - index),
    starts_at: String(1000 + index),
  }))
  const newest = { ...campaign, id: '1', starts_at: '90000' }
  vi.mocked(api.get).mockImplementation(async (_url, config) => ({
    data: {
      success: true,
      data: {
        page: (config?.params as { p: number } | undefined)?.p,
        page_size: 20,
        total: '21',
        items:
          (config?.params as { p: number } | undefined)?.p === 1
            ? first
            : [newest],
      },
    },
  }))
  const result = await getLatestCampaigns()
  expect(result.total).toBe('21')
  expect(result.items).toHaveLength(10)
  expect(result.items[0].id).toBe('1')
  expect(result.items[1].starts_at).toBe('1019')
  expect(api.get).toHaveBeenCalledTimes(2)
})

it('rejects an incomplete campaign history instead of presenting partial records', async () => {
  const { getLatestCampaigns } = await import('../api')
  vi.mocked(api.get).mockImplementation(async (_url, config) => ({
    data: {
      success: true,
      data: {
        page: (config?.params as { p: number } | undefined)?.p,
        page_size: 20,
        total: '21',
        items:
          (config?.params as { p: number } | undefined)?.p === 1
            ? Array.from({ length: 20 }, () => campaign)
            : [],
      },
    },
  }))
  await expect(getLatestCampaigns()).rejects.toThrow(
    'Incomplete invitation campaign list'
  )
})

it('shows no fabricated rate or release period when there is no current campaign', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: null } })
  mount()
  expect(await screen.findByText('No active invitation campaign')).toBeVisible()
  expect(screen.queryByText('2.5%')).not.toBeInTheDocument()
  expect(screen.queryByText('Current activity rules')).not.toBeInTheDocument()
})

it('supports one tier and waits for the real summary before declaring a tier reached', async () => {
  const { CampaignPanel } = await import('../campaign-panel')
  const only = {
    ...campaign,
    published_version: null,
    status: 'active' as const,
    tiers: [{ min_effective_friends: 0, rate_bps: 375 }],
  }
  const props = {
    campaign: only,
    authenticated: true,
    share: null,
    onActivities: vi.fn(),
  }
  const { rerender } = render(<CampaignPanel {...props} summaryPending />)
  expect(
    screen.queryByText('Highest reward tier reached')
  ).not.toBeInTheDocument()
  rerender(
    <CampaignPanel
      {...props}
      summary={{
        bound_friends: '3',
        effective_friends: '2',
        pending_friends: '1',
        current_rate_bps: 375,
        next_threshold: null,
        balances: [],
      }}
    />
  )
  expect(screen.getByText('Highest reward tier reached')).toBeVisible()
  expect(
    screen.getByRole('progressbar', { name: 'Cumulative invitation progress' })
  ).toHaveAttribute('value', '1')
  expect(
    screen.getByText('1 friends awaiting 7-day qualification')
  ).toBeVisible()
})

it('uses real order amounts and historical point types in both history tabs', async () => {
  const { RewardHistory } = await import('../reward-history')
  const { rewardSchema } = await import('../api')
  const reward = rewardSchema.parse({
    id: '1',
    order_id: '2',
    order_label: 'Order-2',
    invitee_label: 'F***',
    campaign_name: 'Past campaign',
    campaign_version: '1',
    point_type: { id: '3', code: 'OTHER', name: 'Historical credits' },
    paid_amount_minor: '10000',
    net_paid_amount_minor: '8500',
    rate_bps: 625,
    effective_count: '7',
    paid_at: '1794000000000',
    release_at: '1795000000000',
    original_points: '6250',
    processing_points: '20',
    frozen_points: '5300',
    released_points: '100',
    cancelled_points: '700',
    reversed_points: '130',
    review_due_points: '25',
    status: 'frozen',
  })
  render(
    <RewardHistory
      data={{ page: 1, page_size: 20, total: '1', items: [reward] }}
      summary={{
        bound_friends: '5',
        effective_friends: '3',
        pending_friends: '2',
        current_rate_bps: 825,
        next_threshold: null,
        balances: [],
      }}
      pending={false}
      error={false}
      onRetry={vi.fn()}
      page={1}
      onPageChange={vi.fn()}
    />
  )
  const friends = screen.getByRole('table', {
    name: 'Friend subscription orders',
  })
  expect(friends).toHaveTextContent('¥85.00')
  expect(friends).toHaveTextContent('5,320')
  expect(friends).toHaveTextContent('Historical credits')
  expect(
    screen.getByText('5 friends · 3 effective paying friends · 1 orders')
  ).toBeVisible()
  await userEvent.click(
    screen.getByRole('tab', { name: 'Reward settlement records' })
  )
  const records = screen.getByRole('table', {
    name: 'Reward settlement records',
  })
  expect(records).toHaveTextContent('6.25%')
  expect(records).toHaveTextContent('Cancelled: 700')
  expect(records).toHaveTextContent('Reversed: 130')
  expect(records).toHaveTextContent('Manual review: 25')
  await userEvent.keyboard('{ArrowLeft}')
  expect(screen.getByRole('tab', { name: 'My friends' })).toHaveFocus()
})

it.each([true, false])(
  'shows unknown history counts while data is unavailable (pending=%s)',
  async (pending) => {
    const { RewardHistory } = await import('../reward-history')
    render(
      <RewardHistory
        pending={pending}
        error={!pending}
        onRetry={vi.fn()}
        page={1}
        onPageChange={vi.fn()}
      />
    )
    expect(
      screen.getByText('— friends · — effective paying friends · — orders')
    ).toBeVisible()
    expect(
      screen.queryByText('0 friends · 0 effective paying friends · 0 orders')
    ).not.toBeInTheDocument()
  }
)

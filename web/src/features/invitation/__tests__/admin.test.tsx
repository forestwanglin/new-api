import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
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

import { InvitationCampaignAdmin } from '../admin'

vi.mock('@/components/layout', () => ({
  SectionPageLayout: Object.assign(
    ({ children }: { children: ReactNode }) => <main>{children}</main>,
    {
      Title: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
      Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    }
  ),
}))
vi.mock('@/components/layout/components/page-footer', () => ({
  PageFooterPortal: ({ children }: { children: ReactNode }) => (
    <footer>{children}</footer>
  ),
}))
const campaign = {
  id: '1',
  code: 'first',
  period: 1,
  name: 'First campaign',
  description: 'Description',
  starts_at: '2000000000000',
  ends_at: '2000100000000',
  reward_point_type_id: '1',
  reward_point_type: { id: '1', code: 'GENERAL', name: 'General' },
  freeze_days: 7,
  tiers: [{ min_effective_friends: 0, rate_bps: 500 }],
  rules_text: 'Rules',
  visible: false,
  status: 'draft',
  version: '1',
  published_version: null,
}
const reward = {
  id: '1',
  order_id: '11',
  order_label: 'Order Eleven',
  invitee_label: 'Friend A',
  campaign_id: '1',
  campaign_name: 'First campaign',
  campaign_version: '1',
  point_type: { id: '1', code: 'GENERAL', name: 'General' },
  paid_amount_minor: '10000',
  net_paid_amount_minor: '10000',
  rate_bps: 500,
  effective_count: '0',
  paid_at: '1',
  release_at: '2',
  original_points: '5000',
  processing_points: '0',
  frozen_points: '5000',
  released_points: '0',
  cancelled_points: '0',
  reversed_points: '0',
  review_due_points: '0',
  status: 'FROZEN',
}
const refund = {
  id: '5',
  order_id: '11',
  campaign_name: 'First campaign',
  amount_minor: '100',
  status: 'PREPARED',
  provider: '',
  provider_refund_id: null,
  prepared_at: '1',
  completed_at: null,
  cancelled_at: null,
}
let refunds: Array<
  Omit<typeof refund, 'provider_refund_id'> & {
    provider_refund_id: string | null
  }
> = []
let campaignPages = false
beforeEach(() => {
  refunds = []
  campaignPages = false
  vi.spyOn(api, 'get').mockImplementation(async (url, config) => {
    const params = config?.params as
      | { p?: number; page_size?: number }
      | undefined
    const p = Number(params?.p ?? 1),
      size = Number(params?.page_size ?? 20)
    let data: unknown = {
      page: p,
      page_size: size,
      total: '41',
      items: [campaign],
    }
    if (url === '/api/points/types') {
      data = [{ id: 1, code: 'GENERAL', name: 'General' }]
    }
    if (url.endsWith('/rewards')) {
      data = { page: p, page_size: size, total: '41', items: [reward] }
    }
    if (url.endsWith('/refunds')) {
      data = {
        page: p,
        page_size: size,
        total: String(refunds.length),
        items: refunds,
      }
    }
    if (url.endsWith('/campaigns') && size === 100 && campaignPages) {
      data = {
        page: p,
        page_size: 100,
        total: '101',
        items:
          p === 1
            ? Array.from({ length: 100 }, (_, i) => ({
                ...campaign,
                id: String(i + 1),
                code: `code${i + 1}`,
                name: `Campaign ${i + 1}`,
              }))
            : [{ ...campaign, id: '101', name: 'Last campaign' }],
      }
    }
    return { data: { success: true, data } }
  })
  vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url.endsWith('/refunds')) refunds = [refund]
    if (url.endsWith('/complete')) {
      refunds = [
        {
          ...refund,
          status: 'SUCCEEDED',
          provider: 'manual',
          provider_refund_id: 'verified-123',
        },
      ]
    }
    if (url.endsWith('/cancel')) refunds = [{ ...refund, status: 'CANCELLED' }]
    return { data: { success: true, data: { id: '5' } } }
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
      <InvitationCampaignAdmin />
    </QueryClientProvider>
  )
}

it('tabs keep independent server pages and page-size changes restart at first page', async () => {
  mount()
  await screen.findByText('First campaign')
  await userEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith(
      '/api/invitation/admin/campaigns',
      expect.objectContaining({ params: { p: 2, page_size: 20 } })
    )
  )
  await userEvent.click(
    screen.getByRole('tab', { name: 'Invitation reward orders' })
  )
  await screen.findByText('Order Eleven')
  await userEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
  await userEvent.click(screen.getByRole('tab', { name: 'Campaign list' }))
  await screen.findByText('First campaign')
  expect(
    screen.getByRole('button', { name: 'Go to previous page' })
  ).toBeEnabled()
  await userEvent.click(screen.getByRole('combobox'))
  await userEvent.click(screen.getByRole('option', { name: /^10$/ }))
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith(
      '/api/invitation/admin/campaigns',
      expect.objectContaining({ params: { p: 1, page_size: 10 } })
    )
  )
})
it('campaign filter loads beyond first page and changing it resets reward pagination', async () => {
  campaignPages = true
  mount()
  await userEvent.click(
    screen.getByRole('tab', { name: 'Invitation reward orders' })
  )
  await screen.findByText('Order Eleven')
  await userEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
  await userEvent.click(
    screen.getByRole('combobox', { name: 'Filter by campaign' })
  )
  await userEvent.click(
    await screen.findByRole('option', { name: 'Last campaign (first)' })
  )
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith(
      '/api/invitation/admin/rewards',
      expect.objectContaining({
        params: { p: 1, page_size: 20, campaign_id: '101' },
      })
    )
  )
})
it('registering an order refund creates history and retains the reward order', async () => {
  mount()
  await userEvent.click(
    screen.getByRole('tab', { name: 'Invitation reward orders' })
  )
  await screen.findByText('Order Eleven')
  await userEvent.click(screen.getByRole('button', { name: 'Prepare refund' }))
  const dialog = screen.getByRole('alertdialog')
  expect(dialog).toHaveTextContent('Order ID: 11')
  await userEvent.type(
    within(dialog).getByLabelText('Refund amount in minor units'),
    '100'
  )
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Prepare refund' })
  )
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  expect(screen.getByText('Order Eleven')).toBeVisible()
  await userEvent.click(
    screen.getByRole('tab', { name: 'Invitation reward refund registrations' })
  )
  expect(await screen.findByText('Pending refund')).toBeVisible()
  expect(api.post).toHaveBeenCalledWith(
    '/api/invitation/admin/orders/11/refunds',
    { amount_minor: '100', request_id: expect.any(String) }
  )
})
it('failed registration stays open and retries use the same idempotency key', async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new Error('Refund failed'))
  mount()
  await userEvent.click(
    screen.getByRole('tab', { name: 'Invitation reward orders' })
  )
  await screen.findByText('Order Eleven')
  await userEvent.click(screen.getByRole('button', { name: 'Prepare refund' }))
  const dialog = screen.getByRole('alertdialog')
  await userEvent.type(
    within(dialog).getByLabelText('Refund amount in minor units'),
    '100'
  )
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Prepare refund' })
  )
  await within(dialog).findByText('Refund failed')
  const first = vi.mocked(api.post).mock.calls[0][1]
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Prepare refund' })
  )
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  expect(vi.mocked(api.post).mock.calls[1][1]).toEqual(first)
})
it('completion requires verified provider evidence and retains the completed record', async () => {
  refunds = [refund]
  mount()
  await userEvent.click(
    screen.getByRole('tab', { name: 'Invitation reward refund registrations' })
  )
  await screen.findByText('Pending refund')
  await userEvent.click(screen.getByRole('button', { name: 'Complete refund' }))
  const dialog = screen.getByRole('alertdialog'),
    confirm = within(dialog).getByRole('button', { name: 'Complete refund' })
  expect(confirm).toBeDisabled()
  await userEvent.type(within(dialog).getByLabelText('Provider'), 'manual')
  await userEvent.type(
    within(dialog).getByLabelText('Verified provider refund ID'),
    'verified-123'
  )
  await userEvent.click(confirm)
  expect(await screen.findByText('Completed')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Complete refund' })
  ).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledWith(
    '/api/invitation/admin/orders/11/refunds/5/complete',
    {
      amount_minor: '100',
      provider: 'manual',
      provider_refund_id: 'verified-123',
    }
  )
})
it('cancelling a registration preserves a cancelled history row', async () => {
  refunds = [refund]
  mount()
  await userEvent.click(
    screen.getByRole('tab', { name: 'Invitation reward refund registrations' })
  )
  await screen.findByText('Pending refund')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel refund' }))
  await userEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Cancel refund',
    })
  )
  expect(await screen.findByText('Cancelled')).toBeVisible()
})
it('copying preserves all campaign configuration and new creation resets the form', async () => {
  mount()
  await screen.findByText('First campaign')
  await userEvent.click(
    screen.getByRole('button', { name: 'Copy to next campaign' })
  )
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByLabelText('Campaign code')).toHaveValue(
    'first-next'
  )
  expect(within(dialog).getByLabelText('Campaign period')).toHaveValue(2)
  expect(
    within(dialog).getByRole('checkbox', { name: 'Visible' })
  ).not.toBeChecked()
  expect(within(dialog).getByLabelText('Campaign rules')).toHaveValue('Rules')
  expect(within(dialog).getByLabelText('Starts at')).toHaveValue('')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await userEvent.click(screen.getByRole('button', { name: 'New campaign' }))
  expect(screen.getByLabelText('Campaign code')).toHaveValue('')
  expect(screen.getByRole('checkbox', { name: 'Visible' })).toBeChecked()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
})

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { StaticDataTableColumn } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { InvitationAdminTable } from './admin-table'
import {
  getAdminRewards,
  getAdminCampaignOptions,
  formatPoints,
  formatMoneyMinor,
  type Reward,
} from './api'
import {
  InvitationOperationDialog,
  type InvitationOperation,
} from './refund-dialog'

export function InvitationRewardAdmin(props: { active: boolean }) {
  const { t } = useTranslation()
  const viewer = useAuthStore((s) => s.auth.user?.id)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [campaign, setCampaign] = useState('all')
  const [operation, setOperation] = useState<InvitationOperation | null>(null)
  const q = useQuery({
    queryKey: ['invitation', 'admin', 'rewards', viewer, pagination, campaign],
    queryFn: () =>
      getAdminRewards(
        pagination.pageIndex + 1,
        pagination.pageSize,
        campaign === 'all' ? undefined : campaign
      ),
    enabled: props.active,
  })
  const campaigns = useQuery({
    queryKey: ['invitation', 'admin', 'campaign-options', viewer],
    queryFn: getAdminCampaignOptions,
    enabled: props.active,
  })
  const statuses: Record<string, string> = {
    CAPTURED: t('Processing'),
    FROZEN: t('Frozen'),
    RELEASED: t('Reward released'),
    CANCELLED: t('Cancelled'),
    REVIEW_REQUIRED: t('Manual review'),
  }
  const columns: StaticDataTableColumn<Reward>[] = [
    { id: 'order', header: t('Order ID'), cell: (r) => r.order_label },
    { id: 'invitee', header: t('User'), cell: (r) => r.invitee_label },
    {
      id: 'campaign',
      header: t('Campaign name'),
      cell: (r) => (
        <span className='block max-w-56 break-words'>{r.campaign_name}</span>
      ),
    },
    {
      id: 'paid',
      header: t('Paid amount'),
      cell: (r) => `¥${formatMoneyMinor(r.paid_amount_minor)}`,
    },
    {
      id: 'net',
      header: t('Net paid amount'),
      cell: (r) => `¥${formatMoneyMinor(r.net_paid_amount_minor)}`,
    },
    {
      id: 'type',
      header: t('Reward point type'),
      cell: (r) => r.point_type.name,
    },
    {
      id: 'original',
      header: t('Original points'),
      cell: (r) => formatPoints(r.original_points),
    },
    {
      id: 'released',
      header: t('Released invitation points'),
      cell: (r) => formatPoints(r.released_points),
    },
    {
      id: 'review',
      header: t('Review due'),
      cell: (r) => formatPoints(r.review_due_points),
    },
    {
      id: 'status',
      header: t('Status'),
      cell: (r) => statuses[r.status] ?? r.status,
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: (r) => (
        <div className='flex flex-wrap gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={r.net_paid_amount_minor === '0'}
            onClick={() => setOperation({ kind: 'prepare', reward: r })}
          >
            {t('Prepare refund')}
          </Button>
          {r.review_due_points !== '0' && (
            <Button
              size='sm'
              variant='outline'
              onClick={() => setOperation({ kind: 'reverse', reward: r })}
            >
              {t('Reverse released reward')}
            </Button>
          )}
        </div>
      ),
    },
  ]
  if (!props.active) return null
  return (
    <>
      <div className='shrink-0'>
        <Select
          value={campaign}
          onValueChange={(value) => {
            setCampaign(value ?? 'all')
            setPagination((p) => ({ ...p, pageIndex: 0 }))
          }}
          items={[
            { value: 'all', label: t('All campaigns') },
            ...(campaigns.data ?? []).map((c) => ({
              value: c.id,
              label: `${c.name} (${c.code})`,
            })),
          ]}
        >
          <SelectTrigger
            aria-label={t('Filter by campaign')}
            className='w-full sm:w-80'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>{t('All campaigns')}</SelectItem>
            {campaigns.data?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name} ({c.code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {campaigns.isError && (
          <ErrorState
            description={getServerErrorMessage(campaigns.error)}
            onRetry={() => void campaigns.refetch()}
          />
        )}
      </div>
      <InvitationAdminTable
        rows={q.data?.items ?? []}
        columns={columns}
        total={q.data?.total ?? '0'}
        pagination={pagination}
        onPaginationChange={setPagination}
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      />
      {operation && (
        <InvitationOperationDialog
          operation={operation}
          onClose={() => setOperation(null)}
        />
      )}
    </>
  )
}

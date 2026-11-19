import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { StaticDataTableColumn } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

import { InvitationAdminTable } from './admin-table'
import { getAdminRefunds, formatMoneyMinor, type InvitationRefund } from './api'
import {
  InvitationOperationDialog,
  type InvitationOperation,
} from './refund-dialog'

export function InvitationRefundAdmin(props: { active: boolean }) {
  const { t } = useTranslation()
  const viewer = useAuthStore((s) => s.auth.user?.id)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [operation, setOperation] = useState<InvitationOperation | null>(null)
  const q = useQuery({
    queryKey: ['invitation', 'admin', 'refunds', viewer, pagination],
    queryFn: () =>
      getAdminRefunds(pagination.pageIndex + 1, pagination.pageSize),
    enabled: props.active,
  })
  const statuses = {
    PREPARED: t('Pending refund'),
    SUCCEEDED: t('Completed'),
    CANCELLED: t('Cancelled'),
  }
  const columns: StaticDataTableColumn<InvitationRefund>[] = [
    { id: 'id', header: t('Refund operation ID'), cell: (r) => r.id },
    { id: 'order', header: t('Order ID'), cell: (r) => r.order_id },
    {
      id: 'campaign',
      header: t('Campaign name'),
      cell: (r) => r.campaign_name || '—',
    },
    {
      id: 'amount',
      header: t('Refund amount'),
      cell: (r) => `¥${formatMoneyMinor(r.amount_minor)}`,
    },
    { id: 'status', header: t('Status'), cell: (r) => statuses[r.status] },
    {
      id: 'prepared',
      header: t('Registration time'),
      cell: (r) => new Date(Number(r.prepared_at)).toLocaleString(),
    },
    {
      id: 'completed',
      header: t('Completion time'),
      cell: (r) =>
        r.completed_at
          ? new Date(Number(r.completed_at)).toLocaleString()
          : '—',
    },
    {
      id: 'cancelled',
      header: t('Cancellation time'),
      cell: (r) =>
        r.cancelled_at
          ? new Date(Number(r.cancelled_at)).toLocaleString()
          : '—',
    },
    { id: 'provider', header: t('Provider'), cell: (r) => r.provider || '—' },
    {
      id: 'evidence',
      header: t('Verified provider refund ID'),
      cell: (r) => (
        <span className='block max-w-56 break-all'>
          {r.provider_refund_id || '—'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: (r) =>
        r.status === 'PREPARED' ? (
          <div className='flex gap-2'>
            <Button
              size='sm'
              onClick={() => setOperation({ kind: 'complete', refund: r })}
            >
              {t('Complete refund')}
            </Button>
            <Button
              size='sm'
              variant='outline'
              onClick={() => setOperation({ kind: 'cancel', refund: r })}
            >
              {t('Cancel refund')}
            </Button>
          </div>
        ) : (
          '—'
        ),
    },
  ]
  if (!props.active) return null
  return (
    <>
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

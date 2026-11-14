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
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTablePagination,
  StaticDataTable,
  useDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { formatPlanPrice } from '@/features/custom-subscriptions/lib/format'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  customSubscriptionOrdersKey,
  getCustomSubscriptionOrders,
  type CustomSubscriptionOrder,
} from './api'
import { SubscriptionTime } from './current-subscription'

export function SubscriptionOrders() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const userId = useAuthStore((state) => state.auth.user?.id)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const query = useQuery({
    queryKey: customSubscriptionOrdersKey(
      userId,
      pagination.pageIndex + 1,
      pagination.pageSize
    ),
    queryFn: () =>
      getCustomSubscriptionOrders(
        pagination.pageIndex + 1,
        pagination.pageSize
      ),
    enabled: !!userId,
  })
  const rows = query.data?.items ?? []
  const { table } = useDataTable<CustomSubscriptionOrder>({
    data: rows,
    columns: [],
    manualPagination: true,
    totalCount: query.data?.total ?? 0,
    pagination,
    onPaginationChange: setPagination,
  })
  const columns: StaticDataTableColumn<CustomSubscriptionOrder>[] = [
    {
      id: 'time',
      header: t('Time / order number'),
      cell: (row) => (
        <>
          <SubscriptionTime value={row.created_at} />
          <div className='account-secondary'>{row.trade_no}</div>
        </>
      ),
    },
    {
      id: 'plan',
      header: t('Subscription plan'),
      cell: (row) => (
        <>
          {row.plan_title || t('Plan {{id}}', { id: row.plan_id })}
          <div className='account-secondary'>
            {row.billing_cycle === 'year' ? t('Yearly') : t('Monthly')}
          </div>
        </>
      ),
    },
    {
      id: 'amount',
      header: t('Payment amount'),
      cell: (row) => (
        <>
          {formatPlanPrice(
            row.paid_at ? row.amount_paid_minor : row.amount_due_minor,
            locale
          )}
          <div className='account-secondary'>
            {row.paid_at ? t('Paid amount') : t('Amount due')}
          </div>
        </>
      ),
    },
    {
      id: 'points',
      header: t('Plan points / bonus points / auto-renewal bonus'),
      cell: (row) => (
        <>
          {formatNumber(BigInt(row.paid_points), locale)} /{' '}
          {formatNumber(BigInt(row.bonus_points), locale)} /{' '}
          {formatNumber(BigInt(row.auto_bonus_points), locale)}
        </>
      ),
    },
    {
      id: 'payment',
      header: t('Payment method'),
      cell: (row) => {
        if (row.payment_method === 'alipay') return t('Alipay')
        if (row.payment_method === 'wxpay') return t('WeChat Pay')
        return row.payment_method || '—'
      },
    },
    {
      id: 'status',
      header: t('Status'),
      cell: (row) => {
        const labels: Record<string, string> = {
          pending: t('Pending payment'),
          success: t('Paid'),
          paid: t('Paid'),
          expired: t('Expired'),
          failed: t('Failed'),
          cancelled: t('Cancelled'),
          closed: t('Closed'),
        }
        return (
          <>
            {labels[row.status] ?? row.status}
            <div className='account-secondary'>
              {row.fulfillment_status === 'fulfilled'
                ? t('Fulfilled')
                : t('Not fulfilled')}
            </div>
          </>
        )
      },
    },
  ]
  return (
    <section className='sub-card account-orders'>
      <h2>{t('Subscription orders')}</h2>
      <p>{t('All subscription orders, newest first.')}</p>
      {query.isPending && <LoadingState />}
      {query.isError && (
        <ErrorState
          description={getServerErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.isSuccess && (
        <>
          <StaticDataTable
            data={rows}
            columns={columns}
            getRowKey={(row) => row.id}
            tableClassName='min-w-[850px]'
            emptyContent={<EmptyState title={t('No subscription orders')} />}
          />
          <DataTablePagination table={table} />
        </>
      )}
    </section>
  )
}

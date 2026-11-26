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
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  customSubscriptionSelfKey,
  getCustomSubscriptionSelf,
  type CustomSubscription,
} from './api'
import { SubscriptionTime } from './current-subscription'
import type { PublicSubscriptionPlan } from './plans'

function formatRemainingDuration(
  durationMs: string,
  locale: Parameters<typeof formatNumber>[1],
  t: (key: string) => string
) {
  const totalMinutes = BigInt(durationMs) / 60000n
  const days = totalMinutes / 1440n
  const hours = (totalMinutes % 1440n) / 60n
  const minutes = totalMinutes % 60n
  const parts = [
    days > 0n && `${formatNumber(days, locale)} ${t('days')}`,
    hours > 0n && `${formatNumber(hours, locale)} ${t('hours')}`,
    minutes > 0n && `${formatNumber(minutes, locale)} ${t('minutes')}`,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' ') : `0 ${t('minutes')}`
}

export function SubscriptionSchedule(props: {
  plans: PublicSubscriptionPlan[]
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const statusLabels: Record<string, string> = {
    active: t('Active'),
    paused: t('Paused'),
    expired: t('Expired'),
    cancelled: t('Cancelled'),
  }
  const userId = useAuthStore((state) => state.auth.user?.id)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const query = useQuery({
    queryKey: customSubscriptionSelfKey(userId),
    queryFn: getCustomSubscriptionSelf,
    enabled: !!userId,
    refetchInterval: 10000,
  })
  const rows = query.data?.items ?? []
  const { table } = useDataTable<CustomSubscription>({
    data: rows,
    columns: [],
    pagination,
    onPaginationChange: setPagination,
  })
  const paginatedRows = table.getRowModel().rows.map((row) => row.original)
  const columns: StaticDataTableColumn<CustomSubscription>[] = [
    {
      id: 'plan',
      header: t('Subscription plan'),
      cell: (subscription) =>
        subscription.plan_title ||
        props.plans.find((plan) => plan.id === subscription.plan_id)?.title ||
        t('Plan {{id}}', { id: subscription.plan_id }),
    },
    {
      id: 'status',
      header: t('Status'),
      cell: (subscription) => statusLabels[subscription.status],
    },
    {
      id: 'active',
      header: t('Activation / expiry'),
      cell: (subscription) => (
        <>
          <SubscriptionTime value={subscription.active_since_at} /> /{' '}
          <SubscriptionTime value={subscription.active_until_at} />
        </>
      ),
    },
    {
      id: 'priority',
      header: t('Priority'),
      cell: (subscription) => subscription.priority,
    },
    {
      id: 'remaining',
      header: t('Remaining service'),
      cell: (subscription) =>
        formatRemainingDuration(
          subscription.remaining_duration_ms,
          locale,
          (key) => t(key)
        ),
    },
  ]

  return (
    <section className='sub-card'>
      <h2>{t('My subscription and entitlement schedule')}</h2>
      <p>
        {t(
          'Higher priority subscriptions activate first. Lower priority time is paused and retained; equal priorities follow payment time.'
        )}
      </p>
      {query.isPending && (
        <LoadingState message={t('Loading subscriptions…')} />
      )}
      {query.isError && (
        <ErrorState
          description={getServerErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.isSuccess && !query.data.items.length && (
        <EmptyState title={t('No purchased subscriptions yet')} />
      )}
      {query.isSuccess && rows.length > 0 && (
        <>
          <StaticDataTable
            data={paginatedRows}
            columns={columns}
            getRowKey={(row) => row.id}
            tableClassName='min-w-[760px]'
          />
          <DataTablePagination table={table} />
        </>
      )}
    </section>
  )
}

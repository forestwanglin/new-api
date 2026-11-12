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
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatTimestampToDate } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { getPointLedger, pointLedgerQueryKey } from './api'
import { LedgerDetails } from './components/ledger-details'
import { LedgerFilters } from './components/ledger-filters'
import { POINT_LEDGER_ACTIONS } from './lib/actions'
import type {
  PointLedgerFilters,
  PointLedgerItem,
  PointLedgerScope,
} from './types'

export function PointLedger(props: { scope: PointLedgerScope }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const userId = useAuthStore((state) => state.auth.user?.id)
  const [filters, setFilters] = useState<PointLedgerFilters>({})
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const params = {
    ...filters,
    p: pagination.pageIndex + 1,
    page_size: pagination.pageSize,
  }
  const query = useQuery({
    queryKey: pointLedgerQueryKey(userId, props.scope, params),
    queryFn: () => getPointLedger(props.scope, params),
    enabled: userId !== undefined,
  })
  const rows = query.data?.items ?? []
  const selected = rows.find((row) => row.id === selectedId)
  const { table } = useDataTable<PointLedgerItem>({
    data: rows,
    columns: [],
    manualPagination: true,
    totalCount: query.data?.total ?? 0,
    pagination,
    onPaginationChange: setPagination,
  })
  const columns: StaticDataTableColumn<PointLedgerItem>[] = [
    {
      id: 'time',
      header: t('Time'),
      cell: (row) => formatTimestampToDate(row.created_at, 'milliseconds'),
    },
    {
      id: 'type',
      header: t('Point type'),
      cell: (row) =>
        row.point_type_name || row.point_type_code || row.point_type_id,
    },
    {
      id: 'action',
      header: t('Action'),
      cell: (row) => {
        const action = POINT_LEDGER_ACTIONS.find(
          (entry) => entry.value === row.action
        )
        return action ? t(action.labelKey) : row.action
      },
    },
    {
      id: 'available-delta',
      header: t('Available change'),
      cell: (row) => formatNumber(BigInt(row.available_delta), locale),
    },
    {
      id: 'frozen-delta',
      header: t('Frozen change'),
      cell: (row) => formatNumber(BigInt(row.frozen_delta), locale),
    },
    {
      id: 'available-after',
      header: t('Available after'),
      cell: (row) => formatNumber(BigInt(row.available_after), locale),
    },
    {
      id: 'frozen-after',
      header: t('Frozen after'),
      cell: (row) => formatNumber(BigInt(row.frozen_after), locale),
    },
    {
      id: 'details',
      header: t('Details'),
      cell: (row) => (
        <Button
          variant='outline'
          size='sm'
          onClick={() => setSelectedId(row.id)}
        >
          {t('View details')}
        </Button>
      ),
    },
  ]
  if (props.scope === 'admin') {
    columns.splice(1, 0, {
      id: 'user',
      header: t('User'),
      cell: (row) =>
        row.username ? `${row.username} (${row.user_id})` : row.user_id,
    })
  }
  let content
  if (query.isPending) content = <LoadingState />
  else if (query.isError) {
    content = (
      <ErrorState
        description={getServerErrorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    )
  } else {
    content = (
      <>
        <StaticDataTable
          tableClassName='min-w-[1100px]'
          data={rows}
          getRowKey={(row) => row.id}
          columns={columns}
          emptyContent={<EmptyState title={t('No point ledger entries')} />}
        />
        <div className='mt-3'>
          <DataTablePagination table={table} compact />
        </div>
      </>
    )
  }
  return (
    <div className='min-w-0'>
      <LedgerFilters
        admin={props.scope === 'admin'}
        types={query.data?.point_types ?? []}
        onApply={(value) => {
          setFilters(value)
          setPagination((current) => ({ ...current, pageIndex: 0 }))
          setSelectedId(null)
        }}
      />
      {content}
      {selected && (
        <LedgerDetails item={selected} onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}

export function PointLedgerPage() {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Point Ledger')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <PointLedger key={userId} scope='self' />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

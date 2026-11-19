import type { PaginationState, OnChangeFn } from '@tanstack/react-table'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTablePagination,
  StaticDataTable,
  useDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageFooterPortal } from '@/components/layout/components/page-footer'
import { LoadingState } from '@/components/loading-state'
import { getServerErrorMessage } from '@/lib/server-error-message'

export function InvitationAdminTable<T extends { id: string }>(props: {
  rows: T[]
  columns: StaticDataTableColumn<T>[]
  total: string
  pagination: PaginationState
  onPaginationChange: OnChangeFn<PaginationState>
  pending: boolean
  error: unknown
  onRetry: () => void
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const { table } = useDataTable<T>({
    data: props.rows,
    columns: [],
    manualPagination: true,
    totalCount: Number(props.total),
    pagination: props.pagination,
    onPaginationChange: (updater) =>
      props.onPaginationChange((previous) => {
        const next = typeof updater === 'function' ? updater(previous) : updater
        return {
          ...next,
          pageIndex: next.pageSize === previous.pageSize ? next.pageIndex : 0,
        }
      }),
  })
  if (props.pending) return <LoadingState />
  if (props.error) {
    return (
      <ErrorState
        description={getServerErrorMessage(props.error)}
        onRetry={props.onRetry}
      />
    )
  }
  return (
    <>
      <div className='min-h-0 flex-1 overflow-auto'>
        <StaticDataTable
          tableClassName='min-w-[1100px]'
          data={props.rows}
          columns={props.columns}
          getRowKey={(row) => row.id}
          emptyContent={<EmptyState title={t('No data')} />}
        />
      </div>
      <PageFooterPortal>
        <DataTablePagination table={table} />
      </PageFooterPortal>
      {props.children}
    </>
  )
}

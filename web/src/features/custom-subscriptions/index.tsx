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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
} from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { usePaymentCompliance } from '@/features/system-settings/hooks/use-payment-compliance'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  deletePlan,
  getPlan,
  listPlans,
  savePlan,
  subscriptionKeys,
} from './api'
import { usePlanColumns } from './components/plan-columns'
import { PlanDrawer, type PlanDrawerSelection } from './components/plan-drawer'
import type { CustomSubscriptionPlan, PlanFilters } from './types'

export function CustomSubscriptions() {
  const { t } = useTranslation()
  const viewer = useAuthStore((state) =>
    String(state.auth.user?.id ?? 'anonymous')
  )
  // Remount on identity changes so open drawers and pagination cannot cross accounts.
  return (
    <CustomSubscriptionsContent
      key={viewer}
      viewer={viewer}
      title={t('Custom Subscriptions')}
    />
  )
}

function CustomSubscriptionsContent(props: { viewer: string; title: string }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const complianceConfirmed = usePaymentCompliance()
  const [selection, setSelection] = useState<PlanDrawerSelection | null>(null)
  const [deleting, setDeleting] = useState<CustomSubscriptionPlan | null>(null)
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const [keyword, setKeyword] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const enabled = columnFilters.find((filter) => filter.id === 'enabled')
    ?.value as string[] | undefined
  const cycle = columnFilters.find((filter) => filter.id === 'billing_cycle')
    ?.value as string[] | undefined
  const filters: PlanFilters = {
    p: pagination.pageIndex + 1,
    page_size: pagination.pageSize,
  }
  if (keyword.trim()) filters.keyword = keyword.trim()
  if (enabled?.[0] === 'true' || enabled?.[0] === 'false') {
    filters.enabled = enabled[0]
  }
  if (cycle?.[0] === 'month' || cycle?.[0] === 'year') {
    filters.billing_cycle = cycle[0]
  }
  const query = useQuery({
    queryKey: subscriptionKeys.list(props.viewer, filters),
    queryFn: () => listPlans(filters),
  })
  const refresh = async () => {
    await client.invalidateQueries({
      queryKey: subscriptionKeys.all(props.viewer),
    })
  }
  const remove = useMutation({
    mutationFn: deletePlan,
    onSuccess: async () => {
      setDeleting(null)
      if (query.data?.items.length === 1 && pagination.pageIndex > 0) {
        setPagination((previous) => ({
          ...previous,
          pageIndex: previous.pageIndex - 1,
        }))
      }
      await refresh()
    },
    onError: (error) => handleServerError(error),
  })
  const toggle = useMutation({
    mutationFn: async (row: CustomSubscriptionPlan) => {
      // Read latest configuration, then let the version check arbitrate races.
      const current = await getPlan(row.id)
      return savePlan({ ...current, enabled: !row.enabled }, current)
    },
    onSuccess: refresh,
    onError: (error) => handleServerError(error),
  })
  const columns = usePlanColumns({
    onDetails: (row) => setSelection({ mode: 'details', id: row.id }),
    onEdit: (row) => setSelection({ mode: 'edit', id: row.id }),
    onDelete: (row) => {
      remove.reset()
      setDeleting(row)
    },
    onToggle: (row) => toggle.mutate(row),
    isPending: toggle.isPending || remove.isPending,
    complianceConfirmed,
  })
  const onFiltersChange: OnChangeFn<ColumnFiltersState> = (update) => {
    setColumnFilters(update)
    setPagination((previous) => ({ ...previous, pageIndex: 0 }))
  }
  const { table } = useDataTable({
    data: query.data?.items ?? [],
    columns,
    getRowId: (row) => row.id,
    enableRowSelection: false,
    enableSorting: false,
    manualPagination: true,
    manualFiltering: true,
    manualSorting: true,
    totalCount: query.data?.total ?? 0,
    pagination,
    onPaginationChange: setPagination,
    columnFilters,
    onColumnFiltersChange: onFiltersChange,
    globalFilter: keyword,
    onGlobalFilterChange: (update) => {
      setKeyword(update)
      setPagination((previous) => ({ ...previous, pageIndex: 0 }))
    },
  })
  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{props.title}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            onClick={() => setSelection({ mode: 'create' })}
            disabled={
              !complianceConfirmed ||
              query.isError ||
              !query.data?.point_types.length
            }
          >
            {t('Create plan')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='flex h-full min-h-0 max-w-full min-w-0 flex-col gap-4 overflow-hidden'>
            {!complianceConfirmed && (
              <Alert variant='destructive' className='shrink-0'>
                <AlertDescription>
                  {t(
                    'Subscription plan creation and changes are locked until the administrator confirms compliance terms in Payment Gateway settings.'
                  )}
                </AlertDescription>
              </Alert>
            )}
            {query.isError ? (
              <ErrorState
                description={getServerErrorMessage(query.error)}
                onRetry={() => void query.refetch()}
              />
            ) : (
              <DataTablePage
                table={table}
                columns={columns}
                isLoading={query.isPending}
                isFetching={query.isFetching}
                hideMobile
                applyHeaderSize
                tableClassName='min-w-0 max-w-full'
                emptyTitle={t('No custom subscription plans')}
                emptyDescription={t(
                  'Create a plan or adjust your search and filters.'
                )}
                toolbarProps={{
                  searchPlaceholder: t('Search plan name or code...'),
                  searchDebounceMs: 300,
                  filters: [
                    {
                      columnId: 'enabled',
                      title: t('Status'),
                      singleSelect: true,
                      options: [
                        { value: 'true', label: t('Enabled') },
                        { value: 'false', label: t('Disabled') },
                      ],
                    },
                    {
                      columnId: 'billing_cycle',
                      title: t('Billing cycle'),
                      singleSelect: true,
                      options: [
                        { value: 'month', label: t('Monthly') },
                        { value: 'year', label: t('Yearly') },
                      ],
                    },
                  ],
                }}
              />
            )}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
      {selection && (
        <PlanDrawer
          key={
            selection.mode === 'create'
              ? 'create'
              : `${selection.mode}-${selection.id}`
          }
          selection={selection}
          viewer={props.viewer}
          types={query.isError ? undefined : query.data?.point_types}
          onClose={() => setSelection(null)}
          onSaved={refresh}
          onRetry={() => void query.refetch()}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null)
        }}
        title={t('Delete plan')}
        desc={
          <div className='space-y-2'>
            <p className='[overflow-wrap:anywhere]'>{deleting?.title}</p>
            <p>
              {t(
                'Plans with orders cannot be deleted. Disable the plan instead.'
              )}
            </p>
            {remove.isError && (
              <p role='alert' className='text-destructive'>
                {t(getServerErrorMessage(remove.error))}
              </p>
            )}
          </div>
        }
        destructive
        confirmText={t('Delete')}
        isLoading={remove.isPending}
        disabled={!complianceConfirmed}
        handleConfirm={() => {
          if (deleting && complianceConfirmed) remove.mutate(deleting.id)
        }}
      />
    </>
  )
}

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
import type { ColumnFiltersState, PaginationState } from '@tanstack/react-table'
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

import { deleteRule, getRule, listRules, ruleKeys, saveRule } from './api'
import { useRuleColumns } from './rule-columns'
import { RuleDrawer, type RuleSelection } from './rule-drawer'
import type { RuleFilters, SubscriptionRule } from './types'

export function SubscriptionRulesManagement(props: {
  viewer: string
  onBack: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const confirmed = usePaymentCompliance()
  const [selection, setSelection] = useState<RuleSelection | null>(null)
  const [deleting, setDeleting] = useState<SubscriptionRule | null>(null)
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const [keyword, setKeyword] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const enabled = columnFilters.find((filter) => filter.id === 'enabled')
    ?.value as string[] | undefined
  const scope = columnFilters.find((filter) => filter.id === 'scope')?.value as
    | string[]
    | undefined
  const filters: RuleFilters = {
    p: pagination.pageIndex + 1,
    page_size: pagination.pageSize,
  }
  if (keyword.trim()) filters.keyword = keyword.trim()
  if (enabled?.[0] === 'true' || enabled?.[0] === 'false') {
    filters.enabled = enabled[0]
  }
  if (scope?.[0] === 'global' || scope?.[0] === 'plan') filters.scope = scope[0]
  const query = useQuery({
    queryKey: ruleKeys.list(props.viewer, filters),
    queryFn: () => listRules(filters),
  })
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ruleKeys.all(props.viewer) }),
      client.invalidateQueries({ queryKey: ruleKeys.public }),
    ])
  }
  const remove = useMutation({
    mutationFn: deleteRule,
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
    mutationFn: async (row: SubscriptionRule) => {
      const current = await getRule(row.id)
      return saveRule({ ...current, enabled: !current.enabled }, current)
    },
    onSuccess: refresh,
    onError: (error) => handleServerError(error),
  })
  const columns = useRuleColumns({
    onDetails: (row) => setSelection({ mode: 'details', id: row.id }),
    onEdit: (row) => setSelection({ mode: 'edit', id: row.id }),
    onDelete: (row) => {
      remove.reset()
      setDeleting(row)
    },
    onToggle: (row) => {
      if (confirmed) toggle.mutate(row)
    },
    confirmed,
    pending: remove.isPending || toggle.isPending,
  })
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
    onColumnFiltersChange: (update) => {
      setColumnFilters(update)
      setPagination((previous) => ({ ...previous, pageIndex: 0 }))
    },
    globalFilter: keyword,
    onGlobalFilterChange: (update) => {
      setKeyword(update)
      setPagination((previous) => ({ ...previous, pageIndex: 0 }))
    },
  })
  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('Subscription rules')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button variant='outline' onClick={props.onBack}>
            {t('Subscription plans')}
          </Button>
          <Button
            disabled={!confirmed || query.isError}
            onClick={() => setSelection({ mode: 'create' })}
          >
            {t('Create rule')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='flex h-full min-h-0 max-w-full min-w-0 flex-col gap-4 overflow-hidden'>
            {!confirmed && (
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
                description={t(getServerErrorMessage(query.error))}
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
                emptyTitle={t('No subscription rules')}
                emptyDescription={t(
                  'Create a rule or adjust your search and filters.'
                )}
                toolbarProps={{
                  searchPlaceholder: t('Search rule title or key...'),
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
                      columnId: 'scope',
                      title: t('Rule scope'),
                      singleSelect: true,
                      options: [
                        { value: 'global', label: t('Global rule') },
                        { value: 'plan', label: t('Plan-specific rule') },
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
        <RuleDrawer
          key={
            selection.mode === 'create'
              ? 'create'
              : `${selection.mode}-${selection.id}`
          }
          selection={selection}
          viewer={props.viewer}
          onClose={() => setSelection(null)}
          onSaved={refresh}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null)
        }}
        title={t('Delete rule')}
        desc={
          <div className='space-y-2'>
            <p className='[overflow-wrap:anywhere]'>{deleting?.title}</p>
            <p>
              {t(
                'This removes the rule from future page views. Existing orders are unchanged.'
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
        disabled={!confirmed}
        handleConfirm={() => {
          if (deleting && confirmed) remove.mutate(deleting.id)
        }}
      />
    </>
  )
}

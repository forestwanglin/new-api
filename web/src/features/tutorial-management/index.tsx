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
import type { PaginationState, ColumnFiltersState } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { publicTutorialKey } from '@/features/config-tutorial/api'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  deleteTutorialItem,
  getTutorialGroup,
  getTutorialChapter,
  listTutorialGroups,
  listTutorialChapters,
  saveTutorialGroup,
  saveTutorialChapter,
  tutorialKeys,
} from './api'
import { TutorialGroupPicker } from './components/group-picker'
import { useTutorialColumns } from './components/tutorial-columns'
import { TutorialDrawer } from './components/tutorial-drawer'
import type {
  TutorialEntity,
  TutorialSelection,
  TutorialRecord,
  TutorialFilters,
  TutorialList,
} from './types'

export function TutorialManagement() {
  const viewer = useAuthStore((state) =>
    String(state.auth.user?.id ?? 'anonymous')
  )
  const [entity, setEntity] = useState<TutorialEntity>('chapters')
  return (
    <TutorialManagementContent
      key={`${viewer}-${entity}`}
      viewer={viewer}
      entity={entity}
      onEntityChange={setEntity}
    />
  )
}
function TutorialManagementContent(props: {
  viewer: string
  entity: TutorialEntity
  onEntityChange: (entity: TutorialEntity) => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const [keyword, setKeyword] = useState('')
  const [group, setGroup] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [selection, setSelection] = useState<TutorialSelection | null>(null)
  const [deleting, setDeleting] = useState<TutorialRecord | null>(null)
  const enabled = columnFilters.find((filter) => filter.id === 'enabled')
    ?.value as string[] | undefined
  const filters: TutorialFilters = {
    p: pagination.pageIndex + 1,
    page_size: pagination.pageSize,
    ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
    ...(props.entity === 'chapters' && group ? { group_id: group } : {}),
    ...(props.entity === 'chapters' &&
    (enabled?.[0] === 'true' || enabled?.[0] === 'false')
      ? { enabled: enabled[0] }
      : {}),
  }
  const query = useQuery<TutorialList<TutorialRecord>>({
    queryKey: tutorialKeys.list(props.viewer, props.entity, filters),
    queryFn: () =>
      props.entity === 'groups'
        ? listTutorialGroups(filters)
        : listTutorialChapters(filters),
  })
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: tutorialKeys.all(props.viewer) }),
      client.invalidateQueries({ queryKey: publicTutorialKey }),
    ])
  }
  const remove = useMutation({
    mutationFn: (id: string) => deleteTutorialItem(props.entity, id),
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
    mutationFn: async (row: TutorialRecord) => {
      if (props.entity === 'groups') {
        const current = await getTutorialGroup(row.id)
        return saveTutorialGroup({ ...current, enabled: !row.enabled }, current)
      }
      const current = await getTutorialChapter(row.id)
      return saveTutorialChapter({ ...current, enabled: !row.enabled }, current)
    },
    onSuccess: refresh,
    onError: (error) => handleServerError(error),
  })
  const columns = useTutorialColumns({
    viewer: props.viewer,
    entity: props.entity,
    busy: remove.isPending || toggle.isPending,
    onDetails: (row) => setSelection({ mode: 'details', id: row.id }),
    onEdit: (row) => setSelection({ mode: 'edit', id: row.id }),
    onDelete: (row) => {
      remove.reset()
      setDeleting(row)
    },
    onToggle: (row) => toggle.mutate(row),
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
          {t('Tutorial management')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            variant='outline'
            aria-pressed={props.entity === 'chapters'}
            onClick={() => props.onEntityChange('chapters')}
          >
            {t('Chapters')}
          </Button>
          <Button
            variant='outline'
            aria-pressed={props.entity === 'groups'}
            onClick={() => props.onEntityChange('groups')}
          >
            {t('Groups')}
          </Button>
          <Button onClick={() => setSelection({ mode: 'create' })}>
            {t(
              props.entity === 'groups'
                ? 'Create tutorial group'
                : 'Create tutorial chapter'
            )}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden'>
            {props.entity === 'chapters' && (
              <Collapsible className='shrink-0'>
                <CollapsibleTrigger render={<Button variant='outline' />}>
                  {t('Filter by tutorial group')}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className='mt-3 max-w-md'>
                    <TutorialGroupPicker
                      viewer={props.viewer}
                      value={group}
                      onChange={(value) => {
                        setGroup(value)
                        setPagination((previous) => ({
                          ...previous,
                          pageIndex: 0,
                        }))
                      }}
                      allowAll
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
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
                emptyTitle={t(
                  props.entity === 'groups'
                    ? 'No tutorial groups'
                    : 'No tutorial chapters'
                )}
                emptyDescription={t(
                  'Create tutorial content or adjust your search and filters.'
                )}
                toolbarProps={{
                  searchPlaceholder: t('Search tutorial title or key...'),
                  searchDebounceMs: 300,
                  filters:
                    props.entity === 'chapters'
                      ? [
                          {
                            columnId: 'enabled',
                            title: t('Status'),
                            singleSelect: true,
                            options: [
                              { value: 'true', label: t('Enabled') },
                              { value: 'false', label: t('Disabled') },
                            ],
                          },
                        ]
                      : [],
                }}
              />
            )}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
      {selection && (
        <TutorialDrawer
          key={
            selection.mode === 'create'
              ? 'create'
              : `${selection.mode}-${selection.id}`
          }
          entity={props.entity}
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
        title={t(
          props.entity === 'groups'
            ? 'Delete tutorial group'
            : 'Delete tutorial chapter'
        )}
        desc={
          <div className='space-y-2'>
            <p className='[overflow-wrap:anywhere]'>{deleting?.title}</p>
            <p>
              {t(
                props.entity === 'groups'
                  ? 'Groups containing chapters cannot be deleted. Move or delete their chapters first.'
                  : 'This chapter will be removed from the tutorial.'
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
        handleConfirm={() => {
          if (deleting) remove.mutate(deleting.id)
        }}
      />
    </>
  )
}

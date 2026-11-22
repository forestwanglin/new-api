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

import { StaticDataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { getPointTypes, pointsQueryKeys } from './api'
import { PointDeleteDialog } from './components/point-delete-dialog'
import { PointRulesDialog } from './components/point-rules-dialog'
import { PointTypeDialog } from './components/point-type-dialog'
import type { PointType } from './types'

export function Points() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [editType, setEditType] = useState<PointType | null | undefined>(
    undefined
  )
  const [deleteType, setDeleteType] = useState<PointType | null>(null)
  const [selectedType, setSelectedType] = useState<PointType | null>(null)
  const query = useQuery({
    queryKey: pointsQueryKeys.types,
    queryFn: getPointTypes,
  })

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
      <StaticDataTable
        tableClassName='min-w-[560px]'
        data={query.data}
        getRowKey={(type) => type.id}
        emptyContent={<EmptyState title={t('No point types configured')} />}
        columns={[
          {
            id: 'code',
            header: t('Point type code'),
            cell: (type) => type.code,
          },
          { id: 'name', header: t('Name'), cell: (type) => type.name },
          {
            id: 'priority',
            header: `${t('Consumption priority')} (${t('Higher values first')})`,
            className: 'text-right',
            cellClassName: 'text-right tabular-nums',
            cell: (type) => formatNumber(type.consume_priority, locale),
          },
          {
            id: 'actions',
            header: t('Actions'),
            className: 'text-right',
            cell: (type) => (
              <div className='flex flex-wrap justify-end gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setEditType(type)}
                >
                  {t('Edit point type')}
                </Button>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setSelectedType(type)}
                >
                  {t('Manage model rules')}
                </Button>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={type.code === 'GENERAL'}
                  aria-describedby={
                    type.code === 'GENERAL'
                      ? `point-type-protected-${type.id}`
                      : undefined
                  }
                  onClick={() => setDeleteType(type)}
                >
                  {t('Delete point type')}
                </Button>
                {type.code === 'GENERAL' && (
                  <span
                    id={`point-type-protected-${type.id}`}
                    className='sr-only'
                  >
                    {t('GENERAL is a system point type and cannot be deleted')}
                  </span>
                )}
              </div>
            ),
          },
        ]}
      />
    )
  }

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Point types')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <p className='text-muted-foreground mb-4 text-sm'>
          {t(
            'Create and edit point types, configure model and channel rules, and delete unused types.'
          )}
        </p>
        <p className='text-muted-foreground mb-4 text-sm'>
          {t('GENERAL is a system point type and cannot be deleted')}
        </p>
        <div className='mb-4 flex flex-wrap justify-end gap-2'>
          <Button onClick={() => setEditType(null)}>
            {t('Add point type')}
          </Button>
        </div>
        {content}
        {editType !== undefined && (
          <PointTypeDialog
            key={editType?.id ?? 'new'}
            pointType={editType}
            onClose={() => setEditType(undefined)}
          />
        )}
        {deleteType && (
          <PointDeleteDialog
            key={deleteType.id}
            pointType={deleteType}
            onClose={() => setDeleteType(null)}
          />
        )}
        {selectedType && (
          <PointRulesDialog
            key={selectedType.id}
            pointType={selectedType}
            onClose={() => setSelectedType(null)}
          />
        )}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

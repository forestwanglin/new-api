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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PointLedger } from '@/features/point-ledger'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { getPointTypes, pointsQueryKeys } from './api'
import { PointRulesDialog } from './components/point-rules-dialog'
import type { PointType } from './types'

export function Points() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
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
            header: t('Consumption priority'),
            className: 'text-right',
            cellClassName: 'text-right tabular-nums',
            cell: (type) => formatNumber(type.consume_priority, locale),
          },
          {
            id: 'actions',
            header: t('Actions'),
            className: 'text-right',
            cell: (type) => (
              <div className='flex justify-end'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setSelectedType(type)}
                >
                  {t('Manage model rules')}
                </Button>
              </div>
            ),
          },
        ]}
      />
    )
  }

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Points')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <Tabs defaultValue='configuration'>
          <TabsList className='mb-4'>
            <TabsTrigger value='configuration'>
              {t('Point configuration')}
            </TabsTrigger>
            <TabsTrigger value='ledger'>{t('Point Ledger')}</TabsTrigger>
          </TabsList>
          <TabsContent value='configuration'>
            <p className='text-muted-foreground mb-4 text-sm'>
              {t(
                'Point types are maintained through scripts or the database. Manage their supported models here.'
              )}
            </p>
            {content}
            {selectedType && (
              <PointRulesDialog
                key={selectedType.id}
                pointType={selectedType}
                onClose={() => setSelectedType(null)}
              />
            )}
          </TabsContent>
          <TabsContent value='ledger'>
            <PointLedger scope='admin' />
          </TabsContent>
        </Tabs>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

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
import type { ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { TutorialEntity, TutorialRecord } from '../types'
import { TutorialGroupTitle } from './tutorial-group-title'

export function useTutorialColumns(props: {
  viewer: string
  entity: TutorialEntity
  busy: boolean
  onDetails: (row: TutorialRecord) => void
  onEdit: (row: TutorialRecord) => void
  onDelete: (row: TutorialRecord) => void
  onToggle: (row: TutorialRecord) => void
}): ColumnDef<TutorialRecord, unknown>[] {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return [
    {
      accessorKey: 'title',
      header: t('Title'),
      size: 240,
      cell: ({ row }) => (
        <div className='max-w-64 [overflow-wrap:anywhere] whitespace-normal'>
          <span className='font-medium'>{row.original.title}</span>
          <p className='text-muted-foreground text-xs'>
            {'group_key' in row.original
              ? row.original.group_key
              : row.original.anchor}
          </p>
        </div>
      ),
    },
    ...(props.entity === 'chapters'
      ? [
          {
            id: 'group_id',
            header: t('Tutorial group'),
            size: 120,
            cell: ({ row }: { row: { original: TutorialRecord } }) =>
              'group_id' in row.original ? (
                <TutorialGroupTitle
                  viewer={props.viewer}
                  id={row.original.group_id}
                />
              ) : (
                ''
              ),
          },
        ]
      : []),
    {
      accessorKey: 'sort_order',
      header: t('Sort order'),
      size: 100,
      cell: ({ row }) => formatNumber(row.original.sort_order, locale),
    },
    {
      accessorKey: 'enabled',
      header: t('Status'),
      size: 110,
      cell: ({ row }) => (
        <Badge variant={row.original.enabled ? 'default' : 'secondary'}>
          {t(row.original.enabled ? 'Enabled' : 'Disabled')}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: t('Actions'),
      size: 260,
      cell: ({ row }) => (
        <div className='flex flex-wrap gap-1'>
          <Button
            size='sm'
            variant='ghost'
            onClick={() => props.onDetails(row.original)}
          >
            {t('Details')}
          </Button>
          <Button
            size='sm'
            variant='ghost'
            disabled={props.busy}
            onClick={() => props.onEdit(row.original)}
          >
            {t('Edit')}
          </Button>
          <Button
            size='sm'
            variant='ghost'
            disabled={props.busy}
            onClick={() => props.onToggle(row.original)}
          >
            {t(row.original.enabled ? 'Disable' : 'Enable')}
          </Button>
          <Button
            size='sm'
            variant='ghost'
            disabled={props.busy}
            onClick={() => props.onDelete(row.original)}
          >
            {t('Delete')}
          </Button>
        </div>
      ),
    },
  ]
}

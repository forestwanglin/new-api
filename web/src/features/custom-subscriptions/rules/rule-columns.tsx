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
import type { SubscriptionRule } from './types'

export function useRuleColumns(props: { onDetails: (rule: SubscriptionRule) => void; onEdit: (rule: SubscriptionRule) => void; onDelete: (rule: SubscriptionRule) => void; onToggle: (rule: SubscriptionRule) => void; confirmed: boolean; pending: boolean }): ColumnDef<SubscriptionRule, unknown>[] {
 const { t, i18n } = useTranslation()
 const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
 return [
  { accessorKey: 'id', header: t('ID'), size: 80 },
  { accessorKey: 'title', header: t('Rule title'), size: 260, cell: ({ row }) => <div className='max-w-64 [overflow-wrap:anywhere] whitespace-normal'><div className='font-medium'>{row.original.title}</div><p className='text-muted-foreground text-xs'>{row.original.rule_key}</p></div> },
  { id: 'scope', header: t('Rule scope'), size: 180, cell: ({ row }) => <div className='max-w-44 [overflow-wrap:anywhere] whitespace-normal'>{row.original.plan?.title ?? t('Global rule')}</div> },
  { accessorKey: 'enabled', header: t('Status'), size: 100, cell: ({ row }) => <Badge variant={row.original.enabled ? 'default' : 'secondary'}>{t(row.original.enabled ? 'Enabled' : 'Disabled')}</Badge> },
  { accessorKey: 'sort_order', header: t('Sort order'), size: 100, cell: ({ row }) => formatNumber(row.original.sort_order, locale) },
  { accessorKey: 'updated_at', header: t('Updated at'), size: 170, cell: ({ row }) => new Date(row.original.updated_at).toLocaleString(locale) },
  { id: 'actions', header: t('Actions'), size: 300, enableHiding: false, cell: ({ row }) => <div className='flex gap-1'>
   <Button size='sm' variant='ghost' onClick={() => props.onDetails(row.original)}>{t('View details')}</Button>
   <Button size='sm' variant='ghost' disabled={!props.confirmed} onClick={() => props.onEdit(row.original)}>{t('Edit')}</Button>
   <Button size='sm' variant='ghost' disabled={!props.confirmed || props.pending} onClick={() => props.onToggle(row.original)}>{t(row.original.enabled ? 'Disable' : 'Enable')}</Button>
   <Button size='sm' variant='ghost' className='text-destructive' disabled={!props.confirmed || props.pending} onClick={() => props.onDelete(row.original)}>{t('Delete')}</Button>
  </div> },
 ]
}

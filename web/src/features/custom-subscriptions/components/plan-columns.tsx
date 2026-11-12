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

import { formatPlanPrice } from '../lib/format'
import type { CustomSubscriptionPlan, PointTypeOption } from '../types'

export function usePlanColumns(props: {
  onDetails: (plan: CustomSubscriptionPlan) => void
  onEdit: (plan: CustomSubscriptionPlan) => void
  onDelete: (plan: CustomSubscriptionPlan) => void
  onToggle: (plan: CustomSubscriptionPlan) => void
  complianceConfirmed: boolean
  isPending: boolean
}): ColumnDef<CustomSubscriptionPlan, unknown>[] {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const points = (amount: string, type: PointTypeOption | null) => (
    <div>
      <span className='tabular-nums'>
        {formatNumber(BigInt(amount), locale)}
      </span>
      {type && (
        <p className='text-muted-foreground max-w-44 text-xs [overflow-wrap:anywhere] whitespace-normal'>
          {type.name} ({type.code})
        </p>
      )}
    </div>
  )
  return [
    { accessorKey: 'id', header: t('ID'), size: 80 },
    {
      accessorKey: 'title',
      header: t('Plan name'),
      size: 200,
      cell: ({ row }) => (
        <div className='max-w-52 [overflow-wrap:anywhere] whitespace-normal'>
          <div className='font-medium'>{row.original.title}</div>
          <p className='text-muted-foreground text-xs'>{row.original.code}</p>
        </div>
      ),
    },
    {
      accessorKey: 'tier_code',
      header: t('Tier code'),
      size: 130,
      cell: ({ row }) => (
        <div className='max-w-32 [overflow-wrap:anywhere] whitespace-normal'>
          {row.original.tier_code}
          <p className='text-muted-foreground text-xs'>
            {t('Tier rank')}: {formatNumber(row.original.tier_rank, locale)}
          </p>
        </div>
      ),
    },
    {
      accessorKey: 'billing_cycle',
      header: t('Billing cycle'),
      size: 100,
      cell: ({ row }) =>
        t(row.original.billing_cycle === 'month' ? 'Monthly' : 'Yearly'),
    },
    {
      accessorKey: 'price_amount_minor',
      header: t('Price (CNY yuan)'),
      size: 160,
      cell: ({ row }) =>
        formatPlanPrice(row.original.price_amount_minor, locale),
    },
    {
      accessorKey: 'paid_points',
      header: t('Paid points'),
      size: 190,
      cell: ({ row }) =>
        points(row.original.paid_points, row.original.paid_point_type),
    },
    {
      accessorKey: 'bonus_points',
      header: t('Regular bonus points'),
      size: 190,
      cell: ({ row }) =>
        points(row.original.bonus_points, row.original.bonus_point_type),
    },
    {
      accessorKey: 'auto_renew_enabled',
      header: t('Automatic renewal'),
      size: 210,
      cell: ({ row }) => (
        <div className='max-w-52 whitespace-normal'>
          <span>
            {t(row.original.auto_renew_enabled ? 'Enabled' : 'Disabled')}
          </span>
          {row.original.auto_renew_bonus_bps > 0 && (
            <p>
              {formatNumber(row.original.auto_renew_bonus_bps / 100, locale)}% ·{' '}
              {row.original.auto_bonus_point_type?.name ?? '—'}
            </p>
          )}
          <p className='text-muted-foreground text-xs'>
            {t('Configuration only; automatic charging is not connected.')}
          </p>
        </div>
      ),
    },
    {
      accessorKey: 'enabled',
      header: t('Status'),
      size: 100,
      cell: ({ row }) => (
        <Badge variant={row.original.enabled ? 'default' : 'secondary'}>
          {t(row.original.enabled ? 'Enabled' : 'Disabled')}
        </Badge>
      ),
    },
    {
      accessorKey: 'sort_order',
      header: t('Sort order'),
      size: 100,
      cell: ({ row }) => formatNumber(row.original.sort_order, locale),
    },
    {
      id: 'actions',
      header: t('Actions'),
      size: 300,
      enableHiding: false,
      cell: ({ row }) => (
        <div className='flex gap-1'>
          <Button
            size='sm'
            variant='ghost'
            onClick={() => props.onDetails(row.original)}
          >
            {t('View details')}
          </Button>
          <Button
            size='sm'
            variant='ghost'
            disabled={!props.complianceConfirmed}
            onClick={() => props.onEdit(row.original)}
          >
            {t('Edit')}
          </Button>
          <Button
            size='sm'
            variant='ghost'
            disabled={props.isPending || !props.complianceConfirmed}
            onClick={() => props.onToggle(row.original)}
          >
            {t(row.original.enabled ? 'Disable' : 'Enable')}
          </Button>
          <Button
            size='sm'
            variant='ghost'
            className='text-destructive'
            disabled={props.isPending || !props.complianceConfirmed}
            onClick={() => props.onDelete(row.original)}
          >
            {t('Delete')}
          </Button>
        </div>
      ),
    },
  ]
}

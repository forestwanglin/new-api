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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { PointWallet } from './api'

export function PointsWalletDetails(props: { wallet: PointWallet }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const balanceColumns: StaticDataTableColumn<
    PointWallet['balances'][number]
  >[] = [
    {
      id: 'type',
      header: t('Point type'),
      cell: (row) => row.name || row.code,
    },
    {
      id: 'available',
      header: t('Available points'),
      cell: (row) => formatNumber(BigInt(row.available_points), locale),
    },
    {
      id: 'frozen',
      header: t('Frozen points'),
      cell: (row) => formatNumber(BigInt(row.frozen_points), locale),
    },
    {
      id: 'source',
      header: t('Remaining points by source'),
      cell: () => t('Not available yet'),
    },
  ]
  const sourceColumns: StaticDataTableColumn<
    PointWallet['source_summaries'][number]
  >[] = [
    {
      id: 'type',
      header: t('Point type'),
      cell: (row) =>
        row.point_type_name || row.point_type_code || row.point_type_id,
    },
    {
      id: 'source',
      header: t('Source'),
      cell: (row) =>
        row.biz_type === 'custom_subscription'
          ? t('Subscription')
          : row.biz_type,
    },
    {
      id: 'increased',
      header: t('Cumulative increases'),
      cell: (row) => formatNumber(BigInt(row.increased_points), locale),
    },
    {
      id: 'decreased',
      header: t('Cumulative decreases'),
      cell: (row) => formatNumber(BigInt(row.decreased_points), locale),
    },
    {
      id: 'net',
      header: t('Net change'),
      cell: (row) => formatNumber(BigInt(row.net_points), locale),
    },
  ]
  return (
    <section className='account-card wallet-details'>
      <div className='wallet-details-title-row'>
        <h2>{t('Points details')}</h2>
        <Button
          role='link'
          variant='outline'
          render={<Link to='/point-ledger' />}
        >
          {t('View more')}
        </Button>
      </div>
      <p>
        {t(
          'Current available and frozen balances come from your points accounts. Source-specific remaining balances are not available yet.'
        )}
      </p>
      <StaticDataTable
        data={props.wallet.balances}
        columns={balanceColumns}
        getRowKey={(row) => row.point_type_id}
        tableClassName='min-w-[600px]'
        emptyContent={<EmptyState title={t('No points accounts')} />}
      />
      <h3>{t('Cumulative movements by source')}</h3>
      <p>
        {t(
          'Ledger totals are cumulative movements, not remaining balances. Freezing and unfreezing do not count as increases or decreases.'
        )}
      </p>
      <StaticDataTable
        data={props.wallet.source_summaries}
        columns={sourceColumns}
        getRowKey={(row) => `${row.point_type_id}:${row.biz_type}`}
        tableClassName='min-w-[680px]'
        emptyContent={<EmptyState title={t('No point ledger entries')} />}
      />
    </section>
  )
}

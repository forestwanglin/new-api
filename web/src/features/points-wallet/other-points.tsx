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
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { usePointName } from '@/features/points/lib/point-name-context'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

export type OtherTypeRow = {
  point_type_id: string
  code: string
  name: string
  available_points: bigint
  pending_points: bigint
}

const CHART_COLORS = [
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
]

function colorFor(index: number): string {
  return `var(${CHART_COLORS[index % CHART_COLORS.length]})`
}

function percentOf(value: bigint, total: bigint): number {
  if (total <= 0n) return 0
  return Number((value * 10000n) / total) / 100
}

export function OtherPointsCard(props: {
  title: string
  rows: OtherTypeRow[]
  value: (row: OtherTypeRow) => bigint
  description: string
}) {
  const { t, i18n } = useTranslation()
  const pointName = usePointName()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const rows = props.rows.filter((row) => props.value(row) > 0n)
  const total = rows.reduce((sum, row) => sum + props.value(row), 0n)
  return (
    <div className='account-card wallet-stat wallet-other-stat'>
      <h2>{props.title}</h2>
      <div className='wallet-stat-number'>{formatNumber(total, locale)}</div>
      {rows.length > 0 ? (
        <>
          <div
            className='wallet-other-bar'
            role='img'
            aria-label={props.title}
          >
            {rows.map((row, index) => {
              const value = props.value(row)
              return (
                <span
                  key={row.point_type_id}
                  className='wallet-other-bar-segment'
                  style={{
                    width: `${percentOf(value, total)}%`,
                    background: colorFor(index),
                  }}
                />
              )
            })}
          </div>
          <ul className='wallet-other-legend'>
            {rows.map((row, index) => (
              <li key={row.point_type_id}>
                <span
                  className='wallet-other-legend-dot'
                  style={{ background: colorFor(index) }}
                />
                <span className='wallet-other-legend-name'>
                  {pointName({
                    id: row.point_type_id,
                    code: row.code,
                    name: row.name,
                  })}
                </span>
                <span className='wallet-other-legend-value'>
                  {formatNumber(props.value(row), locale)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>{t('No other points accounts')}</p>
      )}
      <p>{props.description}</p>
    </div>
  )
}

export function OtherPointsTable(props: { rows: OtherTypeRow[] }) {
  const { t, i18n } = useTranslation()
  const pointName = usePointName()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const totalAvailable = props.rows.reduce(
    (sum, row) => sum + row.available_points,
    0n
  )
  const totalPending = props.rows.reduce(
    (sum, row) => sum + row.pending_points,
    0n
  )
  return (
    <section className='account-card wallet-other-table'>
      <h2>{t('Other point type details')}</h2>
      {props.rows.length === 0 ? (
        <EmptyState title={t('No other points accounts')} />
      ) : (
        <div className='wallet-other-table-wrap'>
          <Table className='min-w-[600px]'>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Point type')}</TableHead>
                <TableHead className='text-right'>
                  {t('Available points')}
                </TableHead>
                <TableHead className='text-right'>
                  {t('Pending release')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.rows.map((row, index) => (
                <TableRow key={row.point_type_id}>
                  <TableCell>
                    <span className='wallet-other-table-type'>
                      <span
                        className='wallet-other-legend-dot'
                        style={{ background: colorFor(index) }}
                      />
                      {pointName({
                        id: row.point_type_id,
                        code: row.code,
                        name: row.name,
                      })}
                    </span>
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatNumber(row.available_points, locale)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatNumber(row.pending_points, locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>{t('Total')}</TableCell>
                <TableCell className='text-right tabular-nums'>
                  {formatNumber(totalAvailable, locale)}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {formatNumber(totalPending, locale)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </section>
  )
}

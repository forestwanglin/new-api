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

import { Dialog } from '@/components/dialog'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { PointLedgerItem } from '../types'

export function LedgerDetails(props: {
  item: PointLedgerItem
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const item = props.item
  const fields = [
    [t('Ledger ID'), item.id],
    [t('Transaction ID'), item.transaction_id],
    [t('Point account ID'), item.account_id],
    [t('Account version'), item.account_version],
    [t('Freeze ID'), item.freeze_id ?? '—'],
    [t('Related transaction ID'), item.related_transaction_id ?? '—'],
    [t('Business type'), item.biz_type || '—'],
    [t('Business ID'), item.biz_id || '—'],
    [
      t('Available before'),
      formatNumber(BigInt(item.available_before), locale),
    ],
    [t('Available after'), formatNumber(BigInt(item.available_after), locale)],
    [t('Frozen before'), formatNumber(BigInt(item.frozen_before), locale)],
    [t('Frozen after'), formatNumber(BigInt(item.frozen_after), locale)],
    [t('Remark'), item.remark || '—'],
  ]
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Point ledger details')}
    >
      <dl className='grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2'>
        {fields.map(([label, value]) => (
          <div key={label} className='min-w-0'>
            <dt className='text-muted-foreground text-sm'>{label}</dt>
            <dd className='[overflow-wrap:anywhere] whitespace-pre-wrap'>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}

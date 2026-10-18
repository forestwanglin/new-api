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

import { GroupMultiplierBadge } from '@/components/group-badge'
import { cn } from '@/lib/utils'

import {
  formatDiscountPercent,
  type DisplayDiscount,
} from '../lib/display-discount'

/**
 * Group-multiplier badge shown next to the billing mode badge on model cards,
 * table rows and the details header.
 *
 * The ratio drives the badge colours through `GroupMultiplierBadge` (cheaper
 * than 1 renders as info, more expensive as warning) so premium groups are
 * never presented as a discount.
 */
export function PriceDiscountBadge(props: {
  discount: DisplayDiscount
  className?: string
}) {
  const { t } = useTranslation()
  const discount = props.discount

  if (discount.kind === 'none') {
    return null
  }

  const percentText = formatDiscountPercent(discount.percent)
  const label = discount.isBest
    ? `${t('Best group')} ${percentText}`
    : percentText
  const hint = discount.group ? `${discount.group} ${percentText}` : percentText

  return (
    <span
      className={cn('inline-flex min-w-0 shrink-0', props.className)}
      title={hint}
      aria-label={hint}
    >
      <GroupMultiplierBadge
        ratio={discount.ratio}
        label={label}
        className='tabular-nums'
      />
    </span>
  )
}

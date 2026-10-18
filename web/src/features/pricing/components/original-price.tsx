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

import { cn } from '@/lib/utils'

/**
 * Struck-through undiscounted price rendered under the displayed price.
 *
 * Callers must pass a value produced by the same formatter (and the same
 * currency-symbol / precision options) as the displayed price.
 */
export function OriginalPrice(props: { value: string; className?: string }) {
  const { t } = useTranslation()
  const description = `${t('Original price')} ${props.value}`

  return (
    <del
      className={cn(
        // Match the displayed price size in cards and table cells while
        // keeping the struck-through original visually distinct in red.
        'text-destructive text-sm font-normal tabular-nums line-through',
        props.className
      )}
      aria-label={description}
      title={description}
    >
      {props.value}
    </del>
  )
}

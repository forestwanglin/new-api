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
import { Copy, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { GroupBadge } from '@/components/group-badge'
import { Button } from '@/components/ui/button'
import type { ApiKey } from '@/features/keys/types'

type KeySummaryProps = {
  apiKey: ApiKey
  maskedKey: string
  groupRatio?: number | string
  copying: boolean
  onCopyFullKey: () => void
}

function resolveRatio(ratio?: number | string): number | undefined {
  if (typeof ratio === 'number') {
    return Number.isFinite(ratio) ? ratio : undefined
  }
  if (typeof ratio === 'string') {
    const parsed = Number(ratio)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/**
 * Read-only summary of the first API key. The card intentionally offers no key
 * switcher: the newest key is always the one that drives the models and the
 * code samples below.
 */
export function KeySummary(props: KeySummaryProps) {
  const { t } = useTranslation()
  const group = props.apiKey.group?.trim() ?? ''
  const ratio = resolveRatio(props.groupRatio)

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-sm font-medium'>{props.apiKey.name}</span>
        <GroupBadge
          group={group}
          ratio={ratio}
          ratioLabel={group ? undefined : t('Inherited')}
        />
        <Button
          variant='ghost'
          size='sm'
          className='h-7 px-2 text-xs'
          render={<Link to='/keys' />}
        >
          {t('API Keys')}
        </Button>
      </div>
      <div className='bg-muted/40 flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2'>
        <code className='min-w-0 flex-1 truncate font-mono text-xs'>
          {props.maskedKey}
        </code>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='h-7 shrink-0 gap-1.5 px-2 text-xs'
          disabled={props.copying}
          onClick={props.onCopyFullKey}
        >
          {props.copying ? (
            <Loader2 className='size-3.5 animate-spin' />
          ) : (
            <Copy className='size-3.5' />
          )}
          {t('Copy full key')}
        </Button>
      </div>
    </div>
  )
}

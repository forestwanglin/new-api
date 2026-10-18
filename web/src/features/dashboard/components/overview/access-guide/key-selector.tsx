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
import { Copy, Loader2, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import type { ApiKey } from '@/features/keys/types'

type KeySelectorProps = {
  keys: ApiKey[]
  value: number
  maskedKey: string
  ratioByGroup: Record<string, number>
  copying: boolean
  onValueChange: (id: number) => void
  onCopyFullKey: () => void
}

/**
 * API key row for the access guide card: a link to the key settings page, a
 * switcher for the keys the user already owns and a masked value with a
 * copy-full-key action.
 */
export function KeySelector(props: KeySelectorProps) {
  const { t } = useTranslation()

  return (
    <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
      <Button
        variant='outline'
        size='icon-sm'
        className='shrink-0'
        aria-label={t('API Keys')}
        title={t('API Keys')}
        render={<Link to='/keys' />}
      >
        <Settings className='size-4' aria-hidden='true' />
      </Button>

      <NativeSelect
        aria-label={t('API Key')}
        className='w-full sm:w-auto sm:min-w-44'
        value={String(props.value)}
        onChange={(event) => props.onValueChange(Number(event.target.value))}
      >
        {props.keys.map((key) => {
          const group = key.group?.trim() ?? ''
          const ratio = group ? props.ratioByGroup[group] : undefined
          const label = [key.name, group || t('Follow user group')]
          if (typeof ratio === 'number') {
            label.push(`×${ratio}`)
          }

          return (
            <NativeSelectOption key={key.id} value={String(key.id)}>
              {label.join(' · ')}
            </NativeSelectOption>
          )
        })}
      </NativeSelect>

      <div className='bg-muted/40 flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-2'>
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

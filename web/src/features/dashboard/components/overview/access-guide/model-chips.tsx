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

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { formatGroupPrice } from '@/features/pricing/lib/price'
import type { PricingModel } from '@/features/pricing/types'
import { cn } from '@/lib/utils'

type ModelChipsProps = {
  models: PricingModel[]
  selected: string
  group: string
  groupRatio: Record<string, number>
  priceRate: number
  usdExchangeRate: number
  onSelect: (model: string) => void
}

export function ModelChips(props: ModelChipsProps) {
  const { t } = useTranslation()

  if (!props.group) {
    return (
      <p className='text-muted-foreground text-xs'>
        {t('Create a key first to see available models.')}
      </p>
    )
  }

  if (props.models.length === 0) {
    return (
      <p className='text-muted-foreground text-xs'>
        {t('No models available for this group.')}
      </p>
    )
  }

  return (
    <div className='flex flex-wrap items-center gap-2'>
      {props.models.map((model) => {
        const active = model.model_name === props.selected
        const inputPrice = formatGroupPrice(
          model,
          props.group,
          'input',
          'M',
          false,
          props.priceRate,
          props.usdExchangeRate,
          props.groupRatio
        )
        const outputPrice = formatGroupPrice(
          model,
          props.group,
          'output',
          'M',
          false,
          props.priceRate,
          props.usdExchangeRate,
          props.groupRatio
        )

        return (
          <span key={model.model_name} className='inline-flex items-stretch'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              aria-pressed={active}
              className={cn(
                'h-8 gap-2 px-2.5',
                active &&
                  'border-primary bg-primary/10 rounded-r-none border-r-0 text-foreground'
              )}
              onClick={() => props.onSelect(model.model_name)}
            >
              <span className='font-mono text-xs'>{model.model_name}</span>
              <span className='text-muted-foreground font-mono text-[11px]'>
                {inputPrice}/{outputPrice} /1M
              </span>
            </Button>
            {active && (
              <CopyButton
                value={model.model_name}
                variant='outline'
                size='sm'
                className='border-primary bg-primary/10 h-8 rounded-l-none'
                iconClassName='size-3.5'
                aria-label={t('Copy model name')}
              />
            )}
          </span>
        )
      })}
    </div>
  )
}

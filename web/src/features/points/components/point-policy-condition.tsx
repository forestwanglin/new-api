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
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import type { PointPolicyCondition } from '../types'

export function PointPolicyConditionRow(props: {
  condition: PointPolicyCondition
  channels: { id: string; name: string }[]
  invalid: boolean
  disabled: boolean
  onChange: (condition: PointPolicyCondition) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const condition = props.condition
  const channels = props.channels.map((channel) => ({
    value: channel.id,
    label: `${channel.name} (#${channel.id})`,
  }))
  if (
    condition.kind === 'CHANNEL' &&
    condition.channel_id &&
    !props.channels.some((channel) => channel.id === condition.channel_id)
  ) {
    channels.push({
      value: condition.channel_id,
      label: `${t('Unavailable channel')} (#${condition.channel_id})`,
    })
  }
  return (
    <div className='grid min-w-0 gap-3 border-t pt-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto]'>
      <div className='space-y-2'>
        <Label htmlFor={`${id}-kind`}>{t('Condition type')}</Label>
        <Select
          value={condition.kind}
          disabled={props.disabled}
          onValueChange={(kind) =>
            props.onChange(
              kind === 'CHANNEL'
                ? {
                    kind: 'CHANNEL',
                    channel_id: '',
                    enabled: condition.enabled,
                  }
                : {
                    kind: 'MODEL',
                    match_type: 'EXACT',
                    match_value: '',
                    enabled: condition.enabled,
                  }
            )
          }
        >
          <SelectTrigger id={`${id}-kind`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='MODEL'>{t('Model')}</SelectItem>
            <SelectItem value='CHANNEL'>{t('Channel')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {condition.kind === 'MODEL' ? (
        <div className='grid min-w-0 gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]'>
          <div className='space-y-2'>
            <Label htmlFor={`${id}-mode`}>{t('Match mode')}</Label>
            <Select
              value={condition.match_type}
              disabled={props.disabled}
              onValueChange={(value) =>
                props.onChange({
                  ...condition,
                  match_type: value as 'EXACT' | 'PATTERN',
                })
              }
            >
              <SelectTrigger id={`${id}-mode`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='EXACT'>EXACT</SelectItem>
                <SelectItem value='PATTERN'>PATTERN</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='min-w-0 space-y-2'>
            <Label htmlFor={`${id}-value`}>{t('Model name or pattern')}</Label>
            <Input
              id={`${id}-value`}
              aria-invalid={props.invalid}
              value={condition.match_value}
              disabled={props.disabled}
              onChange={(event) =>
                props.onChange({
                  ...condition,
                  match_value: event.target.value,
                })
              }
              placeholder='gpt-*'
            />
          </div>
        </div>
      ) : (
        <div className='min-w-0 space-y-2'>
          <Label htmlFor={`${id}-channel`}>{t('Channel')}</Label>
          <Combobox
            id={`${id}-channel`}
            aria-invalid={props.invalid}
            options={channels}
            value={condition.channel_id}
            onValueChange={(value) =>
              props.onChange({ ...condition, channel_id: value ?? '' })
            }
            disabled={props.disabled}
            placeholder={t('Select channel')}
            searchPlaceholder={t('Search channels')}
            emptyText={t('No channels found')}
          />
        </div>
      )}
      <div className='flex items-end justify-between gap-3 sm:justify-end'>
        <Label className='flex items-center gap-2 pb-2'>
          <Switch
            checked={condition.enabled}
            disabled={props.disabled}
            onCheckedChange={(enabled) =>
              props.onChange({ ...condition, enabled })
            }
          />
          {t('Condition enabled')}
        </Label>
        <Button
          type='button'
          size='sm'
          variant='ghost'
          disabled={props.disabled}
          onClick={props.onRemove}
        >
          {t('Remove condition')}
        </Button>
      </div>
    </div>
  )
}

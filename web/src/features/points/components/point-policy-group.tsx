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
import { useFieldArray, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import type { PointPolicyFormValues } from '../lib/schema'
import type { PointPolicyGroup } from '../types'
import { PointPolicyConditionRow } from './point-policy-condition'

export function PointPolicyGroupEditor(props: {
  group: PointPolicyGroup
  index: number
  channels: { id: string; name: string }[]
  disabled: boolean
  allowAddCondition: boolean
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const form = useFormContext<PointPolicyFormValues>()
  const conditions = useFieldArray({
    control: form.control,
    name: `groups.${props.index}.conditions`,
  })
  return (
    <fieldset
      className='min-w-0 space-y-4 rounded-md border p-3 sm:p-4'
      disabled={props.disabled}
    >
      <legend className='px-1 font-medium'>
        {t('Rule group {{number}}', { number: props.index + 1 })}
      </legend>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div className='space-y-2'>
          <Label htmlFor={id}>{t('Conditions within this group')}</Label>
          <Select
            value={props.group.operator}
            disabled={props.disabled}
            onValueChange={(operator) =>
              form.setValue(
                `groups.${props.index}.operator`,
                operator as 'OR' | 'AND'
              )
            }
          >
            <SelectTrigger id={id}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='OR'>{t('OR — match any')}</SelectItem>
              <SelectItem value='AND'>{t('AND — match all')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Label className='flex items-center gap-2'>
          <Switch
            checked={props.group.enabled}
            disabled={props.disabled}
            onCheckedChange={(enabled) =>
              form.setValue(`groups.${props.index}.enabled`, enabled)
            }
          />
          {t('Group enabled')}
        </Label>
        <Button
          type='button'
          size='sm'
          variant='ghost'
          onClick={props.onRemove}
          disabled={props.disabled}
        >
          {t('Remove group')}
        </Button>
      </div>
      {props.group.conditions.map((condition, index) => (
        <PointPolicyConditionRow
          key={conditions.fields[index].id}
          condition={condition}
          channels={props.channels}
          disabled={props.disabled}
          invalid={Boolean(
            form.formState.errors.groups?.[props.index]?.conditions?.[index]
          )}
          onChange={(value) =>
            form.setValue(`groups.${props.index}.conditions.${index}`, value)
          }
          onRemove={() => conditions.remove(index)}
        />
      ))}
      <Button
        type='button'
        size='sm'
        variant='outline'
        disabled={
          props.disabled ||
          !props.allowAddCondition ||
          props.group.conditions.length >= 64
        }
        onClick={() =>
          conditions.append({
            kind: 'MODEL',
            match_type: 'EXACT',
            match_value: '',
            enabled: true,
          })
        }
      >
        {t('Add condition')}
      </Button>
    </fieldset>
  )
}

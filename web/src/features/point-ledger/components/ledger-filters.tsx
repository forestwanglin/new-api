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
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { POINT_LEDGER_ACTIONS } from '../lib/actions'
import type { PointLedgerFilters, PointLedgerType } from '../types'

const schema = z
  .object({
    user_id: z
      .string()
      .refine(
        (value) =>
          value === '' ||
          (/^[1-9]\d*$/.test(value) && BigInt(value) <= 9223372036854775807n)
      ),
    point_type_id: z.string(),
    action: z.string(),
    start: z.string(),
    end: z.string(),
  })
  .refine((values) => {
    const start = values.start ? new Date(values.start).getTime() : undefined
    const end = values.end ? new Date(values.end).getTime() : undefined
    return (
      (start === undefined || (Number.isSafeInteger(start) && start >= 0)) &&
      (end === undefined || (Number.isSafeInteger(end) && end >= 0)) &&
      (start === undefined || end === undefined || start < end)
    )
  })
type FilterValues = z.infer<typeof schema>
const defaults: FilterValues = {
  user_id: '',
  point_type_id: 'all',
  action: 'all',
  start: '',
  end: '',
}

export function LedgerFilters(props: {
  admin: boolean
  types: PointLedgerType[]
  onApply: (value: PointLedgerFilters) => void
}) {
  const { t } = useTranslation()
  const form = useForm<FilterValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  })
  const apply = (values: FilterValues) => {
    const filters: PointLedgerFilters = {}
    if (props.admin && values.user_id) filters.user_id = values.user_id
    if (values.point_type_id !== 'all') {
      filters.point_type_id = values.point_type_id
    }
    if (values.action !== 'all') filters.action = values.action
    if (values.start) filters.start_timestamp = new Date(values.start).getTime()
    if (values.end) filters.end_timestamp = new Date(values.end).getTime()
    props.onApply(filters)
  }
  const typeItems = [
    { value: 'all', label: t('All point types') },
    ...props.types.map((type) => ({
      value: type.id,
      label: `${type.name} (${type.code})`,
    })),
  ]
  const actionItems = [
    { value: 'all', label: t('All actions') },
    ...POINT_LEDGER_ACTIONS.map((action) => ({
      value: action.value,
      label: t(action.labelKey),
    })),
  ]
  return (
    <form
      onSubmit={form.handleSubmit(apply)}
      className='mb-4 flex flex-wrap items-end gap-3'
    >
      {props.admin && (
        <div>
          <Label htmlFor='ledger-user'>{t('User ID')}</Label>
          <Input
            id='ledger-user'
            inputMode='numeric'
            {...form.register('user_id')}
            aria-invalid={!!form.formState.errors.user_id}
            className='w-40'
          />
        </div>
      )}
      <div>
        <Label htmlFor='ledger-type'>{t('Point type')}</Label>
        <Controller
          control={form.control}
          name='point_type_id'
          render={({ field }) => (
            <Select
              items={typeItems}
              value={field.value}
              onValueChange={(value) => field.onChange(value ?? 'all')}
            >
              <SelectTrigger id='ledger-type' className='w-48'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>
      <div>
        <Label htmlFor='ledger-action'>{t('Action')}</Label>
        <Controller
          control={form.control}
          name='action'
          render={({ field }) => (
            <Select
              items={actionItems}
              value={field.value}
              onValueChange={(value) => field.onChange(value ?? 'all')}
            >
              <SelectTrigger id='ledger-action' className='w-40'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {actionItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>
      <div>
        <Label htmlFor='ledger-start'>{t('Start time')}</Label>
        <Input
          id='ledger-start'
          type='datetime-local'
          {...form.register('start')}
        />
      </div>
      <div>
        <Label htmlFor='ledger-end'>{t('End time (exclusive)')}</Label>
        <Input
          id='ledger-end'
          type='datetime-local'
          {...form.register('end')}
        />
      </div>
      <Button type='submit'>{t('Search')}</Button>
      <Button
        type='button'
        variant='outline'
        onClick={() => {
          form.reset(defaults)
          props.onApply({})
        }}
      >
        {t('Reset')}
      </Button>
      {Object.keys(form.formState.errors).length > 0 && (
        <p role='alert' className='text-destructive w-full text-sm'>
          {t('Invalid point ledger filters')}
        </p>
      )}
    </form>
  )
}

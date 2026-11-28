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
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { DataTableFacetedFilter } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePointName } from '@/features/points/lib/point-name-context'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { getDefaultTimeRange } from '@/features/usage-logs/lib/utils'

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
    start: z.date().optional(),
    end: z.date().optional(),
  })
  .refine((values) => {
    const start = values.start?.getTime()
    const end = values.end?.getTime()
    return (
      (start === undefined || (Number.isFinite(start) && start >= 0)) &&
      (end === undefined || (Number.isFinite(end) && end >= 0)) &&
      (start === undefined || end === undefined || start < end)
    )
  })
type FilterValues = z.infer<typeof schema>

/**
 * Same default time range as the usage logs page: today 00:00:00 ~ now + 1h.
 */
function defaultFilters(): FilterValues {
  return {
    user_id: '',
    point_type_id: 'all',
    action: 'all',
    ...getDefaultTimeRange(),
  }
}

export function LedgerFilters(props: {
  admin: boolean
  types: PointLedgerType[]
  onApply: (value: PointLedgerFilters) => void
}) {
  const { t } = useTranslation()
  const pointName = usePointName()
  const [baseline, setBaseline] = useState(defaultFilters)
  const form = useForm<FilterValues>({
    resolver: zodResolver(schema),
    defaultValues: baseline,
  })
  const apply = (values: FilterValues) => {
    const filters: PointLedgerFilters = {}
    if (props.admin && values.user_id) filters.user_id = values.user_id
    if (values.point_type_id !== 'all') {
      filters.point_type_id = values.point_type_id
    }
    if (values.action !== 'all') filters.action = values.action
    if (values.start) filters.start_timestamp = values.start.getTime()
    if (values.end) filters.end_timestamp = values.end.getTime()
    props.onApply(filters)
  }
  const typeItems = props.types.map((type) => ({
    value: type.id,
    label: `${pointName(type)} (${type.code})`,
  }))
  const actionItems = POINT_LEDGER_ACTIONS.map((action) => ({
    value: action.value,
    label: t(action.labelKey),
  }))
  const values = form.watch()
  const hasFilters =
    values.user_id !== '' ||
    values.point_type_id !== 'all' ||
    values.action !== 'all' ||
    values.start?.getTime() !== baseline.start?.getTime() ||
    values.end?.getTime() !== baseline.end?.getTime()
  return (
    <form
      onSubmit={form.handleSubmit(apply)}
      className='general-filter-card mb-4 flex min-w-0 flex-wrap items-center gap-2 sm:gap-3'
    >
      {props.admin && (
        <Input
          id='ledger-user'
          inputMode='numeric'
          aria-label={t('User ID')}
          placeholder={t('User ID')}
          {...form.register('user_id')}
          aria-invalid={!!form.formState.errors.user_id}
          className='w-full sm:w-[200px] lg:w-[240px]'
        />
      )}
      <Controller
        control={form.control}
        name='point_type_id'
        render={({ field }) => (
          <DataTableFacetedFilter
            title={t('Point type')}
            options={typeItems}
            singleSelect
            value={field.value === 'all' ? [] : [field.value]}
            onValueChange={(value) => field.onChange(value[0] ?? 'all')}
          />
        )}
      />
      <Controller
        control={form.control}
        name='action'
        render={({ field }) => (
          <DataTableFacetedFilter
            title={t('Action')}
            options={actionItems}
            singleSelect
            value={field.value === 'all' ? [] : [field.value]}
            onValueChange={(value) => field.onChange(value[0] ?? 'all')}
          />
        )}
      />
      <CompactDateTimeRangePicker
        start={values.start}
        end={values.end}
        onChange={({ start, end }) => {
          form.setValue('start', start, { shouldValidate: true })
          form.setValue('end', end, { shouldValidate: true })
        }}
      />
      <Button type='submit'>{t('Search')}</Button>
      <Button
        type='button'
        variant='ghost'
        disabled={!hasFilters}
        onClick={() => {
          const next = defaultFilters()
          setBaseline(next)
          form.reset(next)
          apply(next)
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

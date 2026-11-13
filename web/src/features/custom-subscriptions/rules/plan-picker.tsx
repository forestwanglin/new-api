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
import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { listPlans, subscriptionKeys } from '../api'

export function RulePlanPicker(props: { viewer: string; value: string | null; selectedTitle?: string; onChange: (id: string) => void; disabled?: boolean }) {
  const { t } = useTranslation()
  const id = useId()
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const filters = { p: page, page_size: 20, ...(keyword.trim() ? { keyword: keyword.trim() } : {}) }
  const query = useQuery({ queryKey: subscriptionKeys.list(props.viewer, filters), queryFn: () => listPlans(filters) })
  return <div className='space-y-2'>
    <Label htmlFor={id}>{t('Applicable plan')}</Label>
    <Input aria-label={t('Search applicable plans')} placeholder={t('Search plan name or code...')} value={keyword} disabled={props.disabled} onChange={event => { setKeyword(event.target.value); setPage(1) }} />
    <NativeSelect id={id} className='w-full' value={props.value ?? ''} disabled={props.disabled || query.isPending} onChange={event => props.onChange(event.target.value)}>
      <NativeSelectOption value=''>{t('Select a plan')}</NativeSelectOption>
      {props.value && !query.data?.items.some(plan => plan.id === props.value) && <NativeSelectOption value={props.value}>{props.selectedTitle ?? props.value}</NativeSelectOption>}
      {query.data?.items.map(plan => <NativeSelectOption key={plan.id} value={plan.id}>{plan.title} ({plan.code})</NativeSelectOption>)}
    </NativeSelect>
    {query.isPending && <p role='status'>{t('Loading...')}</p>}
    {query.isError && <div role='alert' className='text-destructive text-sm'>{t(getServerErrorMessage(query.error))}<Button type='button' variant='outline' onClick={() => void query.refetch()}>{t('Retry')}</Button></div>}
    <div className='flex gap-2'>
      <Button type='button' size='sm' variant='outline' aria-label={t('Previous plans')} disabled={props.disabled || page === 1 || query.isFetching} onClick={() => setPage(previous => previous - 1)}>{t('Previous')}</Button>
      <Button type='button' size='sm' variant='outline' aria-label={t('Next plans')} disabled={props.disabled || query.isFetching || !query.data || page * 20 >= query.data.total} onClick={() => setPage(previous => previous + 1)}>{t('Next')}</Button>
    </div>
  </div>
}

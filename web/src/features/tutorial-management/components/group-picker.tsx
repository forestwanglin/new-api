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

import { listTutorialGroups, tutorialKeys } from '../api'

export function TutorialGroupPicker(props: {
  viewer: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  allowAll?: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const filters = {
    p: page,
    page_size: 20,
    ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
  }
  const query = useQuery({
    queryKey: tutorialKeys.list(props.viewer, 'groups', filters),
    queryFn: () => listTutorialGroups(filters),
  })
  return (
    <div className='space-y-2'>
      <Label htmlFor={id}>{t('Tutorial group')}</Label>
      <Input
        aria-label={t('Search tutorial groups')}
        placeholder={t('Search tutorial groups')}
        value={keyword}
        disabled={props.disabled}
        onChange={(event) => {
          setKeyword(event.target.value)
          setPage(1)
        }}
      />
      <NativeSelect
        id={id}
        className='w-full'
        value={props.value}
        disabled={props.disabled || query.isPending}
        onChange={(event) => props.onChange(event.target.value)}
      >
        <NativeSelectOption value=''>
          {t(props.allowAll ? 'All groups' : 'Select a tutorial group.')}
        </NativeSelectOption>
        {props.value &&
          !query.data?.items.some((group) => group.id === props.value) && (
            <NativeSelectOption value={props.value}>
              {props.value}
            </NativeSelectOption>
          )}
        {query.data?.items.map((group) => (
          <NativeSelectOption value={group.id} key={group.id}>
            {group.title} ({group.group_key})
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {query.isPending && <p role='status'>{t('Loading...')}</p>}
      {query.isError && (
        <div role='alert' className='text-destructive text-sm'>
          {t(getServerErrorMessage(query.error))}
          <Button
            type='button'
            variant='outline'
            onClick={() => void query.refetch()}
          >
            {t('Retry')}
          </Button>
        </div>
      )}
      <div className='flex gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          aria-label={t('Previous tutorial groups')}
          disabled={props.disabled || page === 1 || query.isFetching}
          onClick={() => setPage((value) => value - 1)}
        >
          {t('Previous')}
        </Button>
        <Button
          type='button'
          variant='outline'
          size='sm'
          aria-label={t('Next tutorial groups')}
          disabled={
            props.disabled ||
            query.isFetching ||
            !query.data ||
            page * 20 >= query.data.total
          }
          onClick={() => setPage((value) => value + 1)}
        >
          {t('Next')}
        </Button>
      </div>
    </div>
  )
}

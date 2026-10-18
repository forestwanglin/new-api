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
import { Loader2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ApiKeyGroupCombobox,
  type ApiKeyGroupOption,
} from '@/features/keys/components/api-key-group-combobox'

export type CreateKeyInput = {
  name: string
  group: string
}

type CreateKeyFormProps = {
  defaultName: string
  groupOptions: ApiKeyGroupOption[]
  submitting: boolean
  onCancel: () => void
  onSubmit: (input: CreateKeyInput) => void
}

/**
 * Inline creation form for the overview card. It intentionally exposes only the
 * name and group: quota, expiry, IP allowlists and model limits stay on the API
 * keys page.
 */
export function CreateKeyForm(props: CreateKeyFormProps) {
  const { t } = useTranslation()
  const nameId = useId()
  const [name, setName] = useState(props.defaultName)
  const [group, setGroup] = useState('')

  return (
    <form
      className='bg-muted/20 flex flex-col gap-3 rounded-lg border p-3'
      onSubmit={(event) => {
        event.preventDefault()
        props.onSubmit({ name: name.trim(), group })
      }}
    >
      <div className='flex flex-col gap-1.5'>
        <Label htmlFor={nameId} className='text-xs'>
          {t('Name')}
        </Label>
        <Input
          id={nameId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('e.g. my-chatbot-key')}
        />
      </div>
      <div className='flex flex-col gap-1.5'>
        <span className='text-xs font-medium'>{t('Group')}</span>
        <ApiKeyGroupCombobox
          compact
          options={props.groupOptions}
          value={group}
          onValueChange={setGroup}
          placeholder={t('Select a group')}
        />
      </div>
      <p className='text-muted-foreground text-xs'>
        {t(
          'After creation the new key is selected and its group models are listed below.'
        )}
      </p>
      <div className='flex justify-end gap-2'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={props.onCancel}
        >
          {t('Cancel')}
        </Button>
        <Button type='submit' size='sm' disabled={props.submitting}>
          {props.submitting && <Loader2 className='size-3.5 animate-spin' />}
          {t('Create key')}
        </Button>
      </div>
    </form>
  )
}

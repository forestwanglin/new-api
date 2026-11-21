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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { FormProvider, useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { savePointPolicy } from '../api'
import { pointPolicySchema, type PointPolicyFormValues } from '../lib/schema'
import type { PointPolicyConfig } from '../types'
import { PointPolicyGroupEditor } from './point-policy-group'

export function PointPolicyEditor(props: {
  typeId: number
  config: PointPolicyConfig
  channels: { id: string; name: string }[]
  onClose: () => void
  onPendingChange: (pending: boolean) => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [baseVersion] = useState(props.config.config_version)
  const form = useForm<PointPolicyFormValues>({
    resolver: zodResolver(pointPolicySchema),
    defaultValues: props.config.policy,
  })
  const groups = useFieldArray({ control: form.control, name: 'groups' })
  const policy = form.watch()
  const onPendingChange = props.onPendingChange
  const count = policy.groups.reduce(
    (total, group) => total + group.conditions.length,
    0
  )
  const mutation = useMutation({
    mutationFn: (values: PointPolicyFormValues) =>
      savePointPolicy(props.typeId, values, baseVersion),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['points'] })
      toast.success(t('Point rules saved'))
      props.onClose()
    },
    onError: (error) => {
      form.setError('root', { message: getServerErrorMessage(error) })
      handleServerError(error)
    },
  })
  useEffect(() => {
    onPendingChange(mutation.isPending)
  }, [mutation.isPending, onPendingChange])
  const expression = policy.groups
    .filter((group) => group.enabled)
    .map((group) => {
      const conditions = group.conditions
        .filter((condition) => condition.enabled)
        .map((condition) => {
          if (condition.kind === 'MODEL') {
            return `${t('Model')} ${condition.match_type} ${condition.match_value || '…'}`
          }
          const channel = props.channels.find(
            (item) => item.id === condition.channel_id
          )
          return `${t('Channel')} ${channel?.name ?? t('Unavailable channel')} (#${condition.channel_id || '…'})`
        })
      return `(${conditions.join(` ${group.operator} `) || t('No enabled conditions')})`
    })
    .join(` ${policy.operator} `)
  return (
    <FormProvider {...form}>
      <form
        className='space-y-5'
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <div className='space-y-2'>
          <Label htmlFor='point-group-operator'>
            {t('Relationship between groups')}
          </Label>
          <Select
            value={policy.operator}
            disabled={mutation.isPending}
            onValueChange={(value) =>
              form.setValue('operator', value as 'OR' | 'AND')
            }
          >
            <SelectTrigger id='point-group-operator' className='sm:max-w-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='OR'>{t('OR — match any')}</SelectItem>
              <SelectItem value='AND'>{t('AND — match all')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {policy.groups.map((group, index) => (
          <PointPolicyGroupEditor
            key={groups.fields[index].id}
            group={group}
            index={index}
            channels={props.channels}
            disabled={mutation.isPending}
            allowAddCondition={count < 512}
            onRemove={() => groups.remove(index)}
          />
        ))}
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={
            mutation.isPending || policy.groups.length >= 32 || count >= 512
          }
          onClick={() =>
            groups.append({
              operator: 'OR',
              enabled: true,
              conditions: [
                {
                  kind: 'MODEL',
                  match_type: 'EXACT',
                  match_value: '',
                  enabled: true,
                },
              ],
            })
          }
        >
          {t('Add group')}
        </Button>
        <div className='space-y-2'>
          <p className='text-sm font-medium'>{t('Rule expression')}</p>
          <p className='bg-muted rounded-md p-3 text-sm [overflow-wrap:anywhere] break-words'>
            {expression ||
              t(
                'Without an enabled rule, this point type cannot be used for any model.'
              )}
          </p>
        </div>
        {Object.keys(form.formState.errors).some((key) => key !== 'root') && (
          <p role='alert' className='text-destructive text-sm'>
            {t(
              'Check each condition: model values need 1–255 characters, channels must be selected, and enabled groups need an enabled condition.'
            )}
          </p>
        )}
        {form.formState.errors.root && (
          <p role='alert' className='text-destructive text-sm'>
            {t(form.formState.errors.root.message ?? '', {
              skipInterpolation: true,
            })}
          </p>
        )}
        <div className='bg-background sticky bottom-0 flex flex-wrap justify-end gap-2 border-t py-3'>
          <Button
            type='button'
            variant='outline'
            disabled={mutation.isPending}
            onClick={props.onClose}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' disabled={mutation.isPending}>
            {mutation.isPending ? t('Saving...') : t('Save')}
          </Button>
        </div>
      </form>
    </FormProvider>
  )
}

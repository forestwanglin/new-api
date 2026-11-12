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
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { pointsQueryKeys, savePointRule } from '../api'
import { pointRuleSchema, type PointRuleFormValues } from '../lib/schema'
import type { PointModelRule } from '../types'

type Props = {
  typeId: number
  rule: PointModelRule | null
  onClose: () => void
}

export function PointRuleForm(props: Props) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm<PointRuleFormValues>({
    resolver: zodResolver(pointRuleSchema),
    defaultValues: props.rule
      ? {
          match_type: props.rule.match_type,
          match_value: props.rule.match_value,
          enabled: props.rule.enabled,
        }
      : { match_type: 'EXACT', match_value: '', enabled: true },
  })
  const mutation = useMutation({
    mutationFn: (values: PointRuleFormValues) =>
      savePointRule(props.typeId, values, props.rule?.id),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: pointsQueryKeys.rules(props.typeId),
      })
      toast.success(t('Model rule saved'))
      props.onClose()
    },
    onError: (error) => {
      form.setError('root', { message: getServerErrorMessage(error) })
      handleServerError(error)
    },
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      title={props.rule ? t('Edit model rule') : t('Add model rule')}
      description={t(
        'EXACT matches the full model name. PATTERN matches the full name using * and ? only. Matching is case-sensitive.'
      )}
      showCloseButton={!mutation.isPending}
    >
      <Form {...form}>
        <form
          className='space-y-4'
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <FormField
            control={form.control}
            name='match_type'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Match mode')}</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={mutation.isPending}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value='EXACT'>EXACT</SelectItem>
                    <SelectItem value='PATTERN'>PATTERN</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='match_value'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Model name or pattern')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    disabled={mutation.isPending}
                    autoComplete='off'
                    placeholder='gpt-*'
                  />
                </FormControl>
                {form.formState.errors.match_value && (
                  <FormMessage>
                    {t(
                      'Use 1–255 characters without surrounding whitespace or control characters.'
                    )}
                  </FormMessage>
                )}
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <FormItem className='flex items-center justify-between'>
                <FormLabel>{t('Enabled')}</FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={mutation.isPending}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          {form.formState.errors.root && (
            <p role='alert' className='text-destructive text-sm'>
              {form.formState.errors.root.message}
            </p>
          )}
          <div className='flex flex-wrap justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={props.onClose}
              disabled={mutation.isPending}
            >
              {t('Cancel')}
            </Button>
            <Button type='submit' disabled={mutation.isPending}>
              {mutation.isPending ? t('Saving...') : t('Save')}
            </Button>
          </div>
        </form>
      </Form>
    </Dialog>
  )
}

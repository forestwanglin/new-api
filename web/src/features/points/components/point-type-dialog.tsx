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
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

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
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { createPointType, updatePointType } from '../api'
import {
  pointCodeSchema,
  pointNameSchema,
  pointPrioritySchema,
} from '../lib/schema'
import type { PointType } from '../types'

export function PointTypeDialog(props: {
  pointType: PointType | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [original] = useState(props.pointType)
  const schema = z.object({
    code: original ? z.string() : pointCodeSchema,
    name: pointNameSchema,
    consume_priority: pointPrioritySchema,
  })
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: original?.code ?? '',
      name: original?.name ?? '',
      consume_priority: String(original?.consume_priority ?? 0),
    },
  })
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof schema>) => {
      const priority = Number(values.consume_priority)
      if (original) {
        return updatePointType(
          original.id,
          values.name,
          original.config_version,
          priority === original.consume_priority ? undefined : priority
        )
      }
      return createPointType({
        code: values.code,
        name: values.name,
        consume_priority: priority,
      })
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['points'] }),
        client.invalidateQueries({ queryKey: ['points-wallet'] }),
        client.invalidateQueries({ queryKey: ['admin-user-points'] }),
        client.invalidateQueries({ queryKey: ['point-ledger'] }),
        client.invalidateQueries({ queryKey: ['subscription-plans'] }),
        client.invalidateQueries({ queryKey: ['custom-subscriptions'] }),
        client.invalidateQueries({ queryKey: ['invitation'] }),
      ])
      toast.success(t('Point type saved'))
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
      title={original ? t('Edit point type') : t('Add point type')}
      description={
        original
          ? original.code
          : t('Create point types and configure how they can be used.')
      }
      showCloseButton={!mutation.isPending}
    >
      <Form {...form}>
        <form
          noValidate
          className='space-y-4'
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <FormField
            control={form.control}
            name='code'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Point type code')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    readOnly={Boolean(original)}
                    disabled={mutation.isPending}
                    autoComplete='off'
                    maxLength={32}
                  />
                </FormControl>
                <p className='text-muted-foreground text-xs'>
                  {t('The point type code cannot be changed after creation.')}
                </p>
                {form.formState.errors.code && (
                  <FormMessage>
                    {t(
                      'Point type code must start with an uppercase letter and contain only uppercase letters, digits or underscores (1 to 32 characters)'
                    )}
                  </FormMessage>
                )}
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='name'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Name')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    disabled={mutation.isPending}
                    autoComplete='off'
                  />
                </FormControl>
                {form.formState.errors.name && (
                  <FormMessage>
                    {t(
                      'Use 1–64 characters without surrounding whitespace or control characters.'
                    )}
                  </FormMessage>
                )}
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='consume_priority'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Consumption priority')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type='number'
                    step='1'
                    min={-2147483648}
                    max={2147483647}
                    disabled={mutation.isPending}
                  />
                </FormControl>
                <p className='text-muted-foreground text-xs'>
                  {t('Higher values first')}
                </p>
                {form.formState.errors.consume_priority && (
                  <FormMessage>
                    {t('Consumption priority must be a 32-bit integer')}
                  </FormMessage>
                )}
              </FormItem>
            )}
          />
          <p className='text-muted-foreground text-sm'>
            {original
              ? t(
                  'The configured name is used throughout the system. Point codes and balances stay the same.'
                )
              : t(
                  'New point types cannot be used until you configure an enabled eligibility rule.'
                )}
          </p>
          {form.formState.errors.root && (
            <p role='alert' className='text-destructive text-sm'>
              {t(form.formState.errors.root.message ?? '', {
                skipInterpolation: true,
              })}
            </p>
          )}
          <div className='flex flex-wrap justify-end gap-2'>
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
      </Form>
    </Dialog>
  )
}

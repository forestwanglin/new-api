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

import { renamePointType } from '../api'
import { pointNameSchema } from '../lib/schema'
import type { PointType } from '../types'

const schema = z.object({ name: pointNameSchema })
export function PointRenameDialog(props: {
  pointType: PointType
  onClose: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [baseVersion] = useState(props.pointType.config_version)
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: props.pointType.name },
  })
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof schema>) =>
      renamePointType(props.pointType.id, values.name, baseVersion),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['points'] }),
        client.invalidateQueries({ queryKey: ['points-wallet'] }),
      ])
      toast.success(t('Point name saved'))
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
      title={t('Rename point type')}
      description={props.pointType.code}
      showCloseButton={!mutation.isPending}
    >
      <Form {...form}>
        <form
          className='space-y-4'
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
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
          <p className='text-muted-foreground text-sm'>
            {t(
              'The configured name is used throughout the system. Point codes and balances stay the same.'
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

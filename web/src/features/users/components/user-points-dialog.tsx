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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { adjustUserPoints, getUserPoints } from '../api'
import type { AdjustUserPointsPayload } from '../types'

const schema = z.object({
  mode: z.enum(['add', 'subtract']),
  amount: z
    .string()
    .regex(/^[1-9]\d{0,18}$/)
    .refine(
      (value) =>
        /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
    ),
})
type Values = z.infer<typeof schema>
type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: number
  pointTypeId: string
  onSuccess: () => void
}

export function UserPointsDialog(props: Props) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const viewerId = useAuthStore((state) => state.auth.user?.id)
  const fieldId = useId()
  const queryClient = useQueryClient()
  const request = useRef<{ intent: string; id: string } | null>(null)
  const submitting = useRef(false)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { mode: 'add', amount: '' },
    mode: 'onChange',
  })
  const values = form.watch()
  const balances = useQuery({
    queryKey: ['admin-user-points', viewerId, props.userId],
    queryFn: () => getUserPoints(props.userId),
    enabled: props.open && !!viewerId,
    retry: false,
    meta: { errorToast: false },
  })
  const selected = balances.data?.find(
    (item) => item.point_type_id === props.pointTypeId
  )
  const parsed = schema.safeParse(values)
  let after: bigint | undefined
  if (selected && parsed.success) {
    const delta = BigInt(values.amount)
    after =
      BigInt(selected.available_points) +
      (values.mode === 'add' ? delta : -delta)
  }
  const valid =
    after !== undefined &&
    after >= -9223372036854775808n &&
    after <= 9223372036854775807n
  const unavailable =
    balances.isPending ||
    balances.isFetching ||
    balances.isError ||
    !selected ||
    !viewerId
  const mutation = useMutation({
    mutationFn: (payload: AdjustUserPointsPayload) =>
      adjustUserPoints(props.userId, payload),
    onError: (error) => handleServerError(error, t('Failed to adjust points')),
    onSuccess: () => {
      request.current = null
      form.reset()
      toast.success(t('Points adjusted successfully'))
      void queryClient.invalidateQueries({ queryKey: ['admin-user-points'] })
      void queryClient.invalidateQueries({ queryKey: ['point-ledger'] })
      void queryClient.invalidateQueries({ queryKey: ['points-wallet'] })
      props.onOpenChange(false)
      props.onSuccess()
    },
  })
  const onOpenChange = (open: boolean) => {
    if (submitting.current) return
    if (!open && !request.current) form.reset()
    props.onOpenChange(open)
  }
  const submit = form.handleSubmit(async (data) => {
    if (submitting.current || unavailable || !valid || !selected) return
    submitting.current = true
    try {
      const payload = { ...data, point_type_id: selected.point_type_id }
      const intent = JSON.stringify([viewerId, props.userId, payload])
      if (request.current?.intent !== intent) {
        request.current = { intent, id: crypto.randomUUID() }
      }
      await mutation.mutateAsync({ ...payload, request_id: request.current.id })
    } catch {
      // The mutation owns error presentation. Keep the same ID for an uncertain retry.
    } finally {
      submitting.current = false
    }
  })
  const pending = mutation.isPending
  return (
    <Dialog
      open={props.open}
      onOpenChange={onOpenChange}
      title={t('Adjust Points')}
      description={t('Select an operation mode and enter the amount')}
      bodyClassName='space-y-4'
      showCloseButton={!pending}
      footer={
        <>
          <Button
            variant='outline'
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='submit'
            form={fieldId}
            disabled={pending || unavailable || !valid}
          >
            {pending ? t('Processing...') : t('Confirm')}
          </Button>
        </>
      }
    >
      {(balances.isPending || balances.isFetching) && <LoadingState />}
      {!balances.isPending && !balances.isFetching && balances.isError && (
        <ErrorState
          title={t('Failed to load points')}
          onRetry={() => void balances.refetch()}
        />
      )}
      {!balances.isPending &&
        !balances.isFetching &&
        !balances.isError &&
        !selected && <EmptyState title={t('No point types configured')} />}
      {!balances.isPending &&
        !balances.isFetching &&
        !balances.isError &&
        selected && (
          <form id={fieldId} onSubmit={submit} className='space-y-4'>
            <p className='text-sm font-medium break-words'>
              {selected.name || selected.code} ({selected.code})
            </p>
            <div
              role='status'
              className='text-muted-foreground text-sm break-words tabular-nums'
            >
              {t('Available points')}:{' '}
              {formatNumber(BigInt(selected.available_points), locale)}
              {valid && after !== undefined && (
                <>
                  {' '}
                  {values.mode === 'add' ? '+' : '-'}
                  {formatNumber(BigInt(values.amount), locale)} ={' '}
                  {formatNumber(after, locale)}
                </>
              )}
            </div>
            <div className='space-y-2'>
              <Label>{t('Mode')}</Label>
              <div className='flex gap-1'>
                {(['add', 'subtract'] as const).map((mode) => (
                  <Button
                    key={mode}
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={pending}
                    aria-pressed={values.mode === mode}
                    className={cn(
                      values.mode === mode &&
                        'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                    )}
                    onClick={() => {
                      form.setValue('mode', mode)
                      form.setValue('amount', '')
                      request.current = null
                    }}
                  >
                    {mode === 'add' ? t('Add') : t('Subtract')}
                  </Button>
                ))}
              </div>
            </div>
            <div className='space-y-2'>
              <Label htmlFor={`${fieldId}-amount`}>
                {t('Amount')} ({t('Points')})
              </Label>
              <Input
                id={`${fieldId}-amount`}
                inputMode='numeric'
                disabled={pending}
                {...form.register('amount', {
                  onChange: () => {
                    request.current = null
                  },
                })}
                aria-invalid={!!values.amount && !valid}
              />
              {!!values.amount && !valid && (
                <p role='alert' className='text-destructive text-sm'>
                  {t(
                    'Enter a positive whole number of points within the supported range'
                  )}
                </p>
              )}
            </div>
          </form>
        )}
    </Dialog>
  )
}

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
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  SideDrawerSection,
  SideDrawerSectionHeader,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
} from '@/components/drawer-layout'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { SheetFooter } from '@/components/ui/sheet'
import { usePaymentCompliance } from '@/features/system-settings/hooks/use-payment-compliance'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { savePlan } from '../api'
import {
  createPlanSchema,
  defaultPlanValues,
  planFormValues,
  toPlanInput,
  type PlanFormValues,
} from '../lib/schema'
import type { CustomSubscriptionPlan, PointTypeOption } from '../types'
import { PlanSelectField, PlanSwitchField, PlanTextField } from './plan-fields'

export function PlanForm(props: {
  plan?: CustomSubscriptionPlan
  types?: PointTypeOption[]
  onClose: () => void
  onSaved: () => Promise<void>
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const complianceConfirmed = usePaymentCompliance()
  const form = useForm<PlanFormValues>({
    resolver: zodResolver(createPlanSchema(props.types ?? [])),
    defaultValues: props.plan ? planFormValues(props.plan) : defaultPlanValues,
  })
  const bonus = form.watch('bonus_points')
  const bps = form.watch('auto_renew_bonus_bps')
  const cycle = form.watch('billing_cycle')
  const catalogUnavailable = !props.types?.length
  const mutation = useMutation({
    mutationFn: (values: PlanFormValues) =>
      savePlan(toPlanInput(values), props.plan),
    onSuccess: async () => {
      await props.onSaved()
      props.onClose()
    },
    onError: (error) => {
      const message = getServerErrorMessage(error)
      form.setError('root.server', { message: t(message) })
      if (message === 'Custom subscription plan code already exists') {
        form.setError('code', { message: t(message) })
      }
      handleServerError(error)
    },
  })
  const typeOptions = [
    { value: '', label: t('Select an available point type') },
    ...(props.types ?? []).map((type) => ({
      value: type.id,
      label: `${type.name} (${type.code})`,
    })),
  ]
  return (
    <Form {...form}>
      <form
        id='custom-subscription-form'
        className={sideDrawerFormClassName()}
        onSubmit={form.handleSubmit((values) => {
          if (!catalogUnavailable && complianceConfirmed) {
            mutation.mutate(values)
          }
        })}
      >
        {catalogUnavailable && (
          <div role='alert' className='text-destructive text-sm'>
            {t('Point type catalog unavailable. Retry before saving.')}{' '}
            <Button type='button' variant='outline' onClick={props.onRetry}>
              {t('Retry')}
            </Button>
          </div>
        )}
        <SideDrawerSection>
          <SideDrawerSectionHeader title={t('Plan basics')} />
          <PlanTextField name='code' label='Plan code' />
          <PlanTextField name='title' label='Plan name' />
          <PlanTextField name='subtitle' label='Subtitle' />
          <div className='grid gap-4 sm:grid-cols-2'>
            <PlanTextField name='tier_code' label='Tier code' />
            <PlanTextField name='tier_rank' label='Tier rank' numeric />
          </div>
        </SideDrawerSection>
        <SideDrawerSection>
          <SideDrawerSectionHeader title={t('Price and billing cycle')} />
          <PlanSelectField
            name='billing_cycle'
            label='Billing cycle'
            options={[
              { value: 'month', label: t('Monthly') },
              { value: 'year', label: t('Yearly') },
            ]}
          />
          <p className='text-muted-foreground text-sm'>
            {t('Duration (months)')}: {cycle === 'month' ? '1' : '12'} · CNY
          </p>
          <PlanTextField name='price_yuan' label='Price (CNY yuan)' numeric />
        </SideDrawerSection>
        <SideDrawerSection>
          <SideDrawerSectionHeader title={t('Points and bonuses')} />
          <PlanTextField name='paid_points' label='Paid points' numeric />
          <PlanSelectField
            name='paid_point_type_id'
            label='Paid point type'
            options={typeOptions}
          />
          <PlanTextField
            name='bonus_points'
            label='Regular bonus points'
            numeric
            onValueChange={(value) => {
              if (value === '0') form.setValue('bonus_point_type_id', '')
            }}
          />
          <PlanSelectField
            name='bonus_point_type_id'
            label='Regular bonus point type'
            options={typeOptions}
            disabled={bonus === '0'}
          />
          <PlanSwitchField
            name='auto_renew_enabled'
            label='Automatic renewal'
          />
          <p className='text-muted-foreground text-sm'>
            {t('Configuration only; automatic charging is not connected.')}
          </p>
          <PlanTextField
            name='auto_renew_bonus_bps'
            label='Automatic renewal bonus (basis points)'
            numeric
            onValueChange={(value) => {
              if (value === '0') form.setValue('auto_bonus_point_type_id', '')
            }}
          />
          <p className='text-muted-foreground text-xs'>
            {t(
              '1000 basis points = 10%. Extra points are rounded down from paid plus regular bonus points.'
            )}
          </p>
          <PlanSelectField
            name='auto_bonus_point_type_id'
            label='Automatic renewal bonus point type'
            options={typeOptions}
            disabled={bps === '0'}
          />
        </SideDrawerSection>
        <SideDrawerSection>
          <SideDrawerSectionHeader title={t('Benefits and availability')} />
          <PlanTextField
            name='benefits_text'
            label='Benefits (one per line, up to 20)'
            multiline
          />
          <PlanSwitchField name='enabled' label='Enabled' />
          <PlanTextField name='sort_order' label='Sort order' numeric />
        </SideDrawerSection>
        {form.formState.errors.root?.server?.message && (
          <p role='alert' className='text-destructive text-sm'>
            {form.formState.errors.root.server.message}
          </p>
        )}
      </form>
      <SheetFooter className={sideDrawerFooterClassName()}>
        <Button
          variant='outline'
          disabled={mutation.isPending}
          onClick={props.onClose}
        >
          {t('Cancel')}
        </Button>
        <Button
          type='submit'
          form='custom-subscription-form'
          disabled={
            !complianceConfirmed || catalogUnavailable || mutation.isPending
          }
        >
          {mutation.isPending ? t('Saving...') : t('Save changes')}
        </Button>
      </SheetFooter>
    </Form>
  )
}

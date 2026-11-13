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
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  SideDrawerSection,
  SideDrawerSectionHeader,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
} from '@/components/drawer-layout'
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { SheetFooter } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { usePaymentCompliance } from '@/features/system-settings/hooks/use-payment-compliance'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { saveRule } from './api'
import { RuleContentEditor } from './content-editor'
import { RulePlanPicker } from './plan-picker'
import { RuleContentView } from './rule-content'
import { defaultRuleInput, ruleInputSchema } from './schema'
import type { RuleInput, SubscriptionRule } from './types'

export function RuleForm(props: {
  viewer: string
  rule?: SubscriptionRule
  onClose: () => void
  onSaved: () => Promise<void>
  refreshError?: string
  onRetry?: () => void
}) {
  const { t } = useTranslation()
  const confirmed = usePaymentCompliance()
  // Bind the draft and its optimistic version to the same initial snapshot.
  const [current] = useState(props.rule)
  const form = useForm<RuleInput>({
    resolver: zodResolver(ruleInputSchema),
    defaultValues: current
      ? {
          plan_id: current.plan_id,
          rule_key: current.rule_key,
          title: current.title,
          content: current.content,
          enabled: current.enabled,
          sort_order: current.sort_order,
        }
      : defaultRuleInput,
  })
  const planId = form.watch('plan_id')
  const content = form.watch('content')
  const title = form.watch('title')
  const mutation = useMutation({
    mutationFn: (values: RuleInput) => saveRule(values, current),
    onSuccess: async () => {
      await props.onSaved()
      props.onClose()
    },
    onError: (error) => {
      const message = getServerErrorMessage(error)
      form.setError('root.server', { message: t(message) })
      if (message === 'Subscription rule key already exists') {
        form.setError('rule_key', { message: t(message) })
      }
      handleServerError(error)
    },
  })
  return (
    <Form {...form}>
      <form
        id='subscription-rule-form'
        className={sideDrawerFormClassName()}
        onSubmit={form.handleSubmit((values) => {
          if (confirmed) mutation.mutate(values)
        })}
      >
        {props.refreshError && (
          <div role='alert' className='text-destructive space-y-2 text-sm'>
            <p>{props.refreshError}</p>
            <p>
              {t(
                'Could not refresh rule. Your draft is preserved; saving still checks its original version.'
              )}
            </p>
            <Button type='button' variant='outline' onClick={props.onRetry}>
              {t('Retry')}
            </Button>
          </div>
        )}
        <p className='text-muted-foreground text-sm'>
          {t(
            'Rules change display text only; pricing, point grants and renewal behavior are configured separately.'
          )}
        </p>
        <SideDrawerSection>
          <SideDrawerSectionHeader title={t('Rule basics')} />
          <FormField
            control={form.control}
            name='rule_key'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Rule key')}</FormLabel>
                <FormControl>
                  <Input {...field} disabled={!!current} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <p className='text-muted-foreground text-xs'>
            {t(
              'Rule keys are globally unique and cannot be changed after creation.'
            )}
          </p>
          <FormField
            control={form.control}
            name='title'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Rule title')}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='plan_id'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Rule scope')}</FormLabel>
                <FormControl>
                  <NativeSelect
                    className='w-full'
                    value={field.value === null ? 'global' : 'plan'}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value === 'global' ? null : ''
                      )
                    }
                  >
                    <NativeSelectOption value='global'>
                      {t('Global rule')}
                    </NativeSelectOption>
                    <NativeSelectOption value='plan'>
                      {t('Plan-specific rule')}
                    </NativeSelectOption>
                  </NativeSelect>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {planId !== null && (
            <RulePlanPicker
              viewer={props.viewer}
              value={planId}
              selectedTitle={current?.plan?.title}
              onChange={(value) =>
                form.setValue('plan_id', value, { shouldValidate: true })
              }
            />
          )}
          <FormField
            control={form.control}
            name='sort_order'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Sort order')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    step={1}
                    {...field}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value === ''
                          ? Number.NaN
                          : Number(event.target.value)
                      )
                    }
                  />
                </FormControl>
                <FormMessage />
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
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </SideDrawerSection>
        <SideDrawerSection>
          <SideDrawerSectionHeader title={t('Rule content')} />
          <RuleContentEditor
            value={content}
            onChange={(value) =>
              form.setValue('content', value, {
                shouldValidate: true,
                shouldDirty: true,
              })
            }
            disabled={mutation.isPending}
          />
          {form.formState.errors.content && (
            <p role='alert' className='text-destructive text-sm'>
              {t('Check rule content and style values before saving.')}
            </p>
          )}
        </SideDrawerSection>
        <SideDrawerSection>
          <SideDrawerSectionHeader title={t('Preview')} />
          <div
            role='region'
            aria-label={t('Preview')}
            className='border-border rounded-lg border p-4'
          >
            <strong className='block text-[16px] leading-[1.6] font-semibold'>
              {title}
            </strong>
            <RuleContentView content={content} />
          </div>
        </SideDrawerSection>
        {form.formState.errors.root?.message && (
          <p role='alert' className='text-destructive text-sm'>
            {form.formState.errors.root.message}
          </p>
        )}
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
          form='subscription-rule-form'
          disabled={!confirmed || mutation.isPending}
        >
          {mutation.isPending ? t('Saving...') : t('Save changes')}
        </Button>
      </SheetFooter>
    </Form>
  )
}

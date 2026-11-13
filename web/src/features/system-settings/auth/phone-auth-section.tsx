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
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const phoneSchema = z.object({
  enabled: z.boolean(),
  region: z.string().min(1),
  sign_name: z.string(),
  template_code: z.string(),
})
// RHF treats dotted field names as nested paths; flatten only at the API boundary.
const schema = z.object({ phone: phoneSchema })
type PhoneFields = z.infer<typeof phoneSchema>
type PhoneSettings = {
  [Key in keyof PhoneFields as `phone.${Key}`]: PhoneFields[Key]
}
function formDefaults(values: PhoneSettings): z.infer<typeof schema> {
  return {
    phone: {
      enabled: values['phone.enabled'],
      region: values['phone.region'],
      sign_name: values['phone.sign_name'],
      template_code: values['phone.template_code'],
    },
  }
}

export function PhoneAuthSection(props: { defaultValues: PhoneSettings }) {
  const { t } = useTranslation()
  const update = useUpdateOption()
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: formDefaults(props.defaultValues),
  })
  useEffect(
    () => form.reset(formDefaults(props.defaultValues)),
    [props.defaultValues, form]
  )
  const save = form.handleSubmit(async (values) => {
    // Persist prerequisites before enabling SMS.
    const keys = ['region', 'sign_name', 'template_code', 'enabled'] as const
    for (const key of keys) {
      if (values.phone[key] !== props.defaultValues[`phone.${key}`]) {
        await update.mutateAsync({
          key: `phone.${key}`,
          value: values.phone[key],
        })
      }
    }
  })
  return (
    <SettingsSection title={t('Phone SMS authentication')}>
      <Form {...form}>
        <SettingsForm onSubmit={save} autoComplete='off'>
          <SettingsPageFormActions onSave={save} isSaving={update.isPending} />
          <FormField
            control={form.control}
            name='phone.enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>
                    {t('Enable phone verification sign in')}
                  </FormLabel>
                  <FormDescription>
                    {t(
                      'Use Alibaba Cloud SMS for phone sign in and WeChat phone binding'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          <p className='text-muted-foreground text-sm'>
            {t(
              'Set ALIYUN_SMS_ACCESS_KEY_ID and ALIYUN_SMS_ACCESS_KEY_SECRET in the server environment, then restart the backend. Secrets are never returned to this page.'
            )}
          </p>
          {(
            [
              ['phone.region', 'Alibaba Cloud region', 'cn-hangzhou'],
              ['phone.sign_name', 'SMS signature name', ''],
              ['phone.template_code', 'SMS template code', 'SMS_...'],
            ] as const
          ).map(([name, label, placeholder]) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t(label)}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={placeholder} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
          <p className='text-muted-foreground text-sm'>
            {t(
              'The approved verification SMS template must contain the code variable. Enable SMS before requiring WeChat users to bind a phone.'
            )}
          </p>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}

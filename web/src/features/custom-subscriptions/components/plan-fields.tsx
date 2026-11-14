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
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import type { PlanFormValues } from '../lib/schema'

type TextName = Exclude<keyof PlanFormValues, 'enabled' | 'auto_renew_enabled'>
export function PlanTextField(props: {
  name: TextName
  label: string
  multiline?: boolean
  description?: string
  numeric?: boolean
  disabled?: boolean
  onValueChange?: (value: string) => void
}) {
  const form = useFormContext<PlanFormValues>()
  const { t } = useTranslation()
  return (
    <FormField
      control={form.control}
      name={props.name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t(props.label)}</FormLabel>
          <FormControl>
            {props.multiline ? (
              <Textarea {...field} rows={5} />
            ) : (
              <Input
                {...field}
                disabled={props.disabled}
                inputMode={props.numeric ? 'decimal' : undefined}
                onChange={(event) => {
                  field.onChange(event)
                  props.onValueChange?.(event.target.value)
                }}
              />
            )}
          </FormControl>
          {props.description && (
            <FormDescription>{t(props.description)}</FormDescription>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
export function PlanSelectField(props: {
  name: TextName
  label: string
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  const form = useFormContext<PlanFormValues>()
  const { t } = useTranslation()
  return (
    <FormField
      control={form.control}
      name={props.name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t(props.label)}</FormLabel>
          <FormControl>
            <NativeSelect
              {...field}
              disabled={props.disabled}
              className='w-full'
            >
              {props.options.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
export function PlanSwitchField(props: {
  name: 'enabled' | 'auto_renew_enabled'
  label: string
  onValueChange?: (value: boolean) => void
}) {
  const form = useFormContext<PlanFormValues>()
  const { t } = useTranslation()
  return (
    <FormField
      control={form.control}
      name={props.name}
      render={({ field }) => (
        <FormItem className='flex items-center justify-between gap-3'>
          <FormLabel>{t(props.label)}</FormLabel>
          <FormControl>
            <Switch
              checked={field.value}
              onCheckedChange={(checked) => {
                field.onChange(checked)
                props.onValueChange?.(checked)
              }}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

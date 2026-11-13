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
import { z } from 'zod'

import {
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  SideDrawerSection,
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
import { SheetFooter } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { TutorialContent } from '@/features/config-tutorial/components/tutorial-content'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { saveTutorialChapter, saveTutorialGroup } from '../api'
import { chapterSchema, groupSchema } from '../lib/schema'
import type { TutorialEntity, TutorialGroup, TutorialChapter } from '../types'
import { TutorialGroupPicker } from './group-picker'

import '@/styles/config-tutorial.css'

const formSchema = z.object({
  group_key: z.string(),
  group_id: z.string(),
  anchor: z.string(),
  title: z.string(),
  content_markdown: z.string(),
  sort_order: z.number(),
  enabled: z.boolean(),
})
type Values = z.infer<typeof formSchema>
export function TutorialForm(props: {
  entity: TutorialEntity
  viewer: string
  item?: TutorialGroup | TutorialChapter
  readOnly?: boolean
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  // Keep the edited values and optimistic version on the same initial snapshot.
  const [current] = useState(props.item)
  const [preview, setPreview] = useState(false)
  const schema = formSchema.superRefine((values, context) => {
    const parsed = (
      props.entity === 'groups' ? groupSchema : chapterSchema
    ).safeParse(values)
    if (!parsed.success) {
      parsed.error.issues.forEach((issue) =>
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        })
      )
    }
  })
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      group_key: current && 'group_key' in current ? current.group_key : '',
      group_id: current && 'group_id' in current ? current.group_id : '',
      anchor: current && 'anchor' in current ? current.anchor : '',
      title: current?.title ?? '',
      content_markdown:
        current && 'content_markdown' in current
          ? current.content_markdown
          : '',
      sort_order: current?.sort_order ?? 0,
      enabled: current?.enabled ?? true,
    },
  })
  const mutation = useMutation<TutorialGroup | TutorialChapter, Error, Values>({
    mutationFn: (values: Values) =>
      props.entity === 'groups'
        ? saveTutorialGroup(groupSchema.parse(values), current)
        : saveTutorialChapter(chapterSchema.parse(values), current),
    onSuccess: async () => {
      await props.onSaved()
      props.onClose()
    },
    onError: (error) => {
      form.setError('root.server', { message: t(getServerErrorMessage(error)) })
      handleServerError(error)
    },
  })
  const disabled = props.readOnly || mutation.isPending
  const textFields =
    props.entity === 'groups'
      ? [
          { name: 'group_key' as const, label: 'Group key', immutable: true },
          { name: 'title' as const, label: 'Title', immutable: false },
        ]
      : [
          { name: 'anchor' as const, label: 'Chapter anchor', immutable: true },
          { name: 'title' as const, label: 'Title', immutable: false },
        ]
  return (
    <Form {...form}>
      <form
        className={sideDrawerFormClassName()}
        onSubmit={form.handleSubmit((values) => {
          if (!props.readOnly) mutation.mutate(values)
        })}
      >
        <SideDrawerSection>
          {textFields.map((item) => (
            <FormField
              key={item.name}
              control={form.control}
              name={item.name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t(item.label)}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      readOnly={props.readOnly || (!!current && item.immutable)}
                      disabled={mutation.isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
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
                    max={2147483647}
                    step={1}
                    value={field.value}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value === ''
                          ? Number.NaN
                          : Number(event.target.value)
                      )
                    }
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    disabled={disabled}
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
                    disabled={disabled}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {props.entity === 'chapters' && (
            <>
              <FormField
                control={form.control}
                name='group_id'
                render={({ field }) => (
                  <FormItem>
                    <TutorialGroupPicker
                      viewer={props.viewer}
                      value={field.value}
                      onChange={field.onChange}
                      disabled={disabled}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='content_markdown'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Markdown content')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        className='min-h-64 font-mono text-sm'
                        readOnly={props.readOnly}
                        disabled={mutation.isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {!props.readOnly && (
                <Button
                  type='button'
                  variant='outline'
                  aria-expanded={preview}
                  onClick={() => setPreview((value) => !value)}
                >
                  {t('Preview')}
                </Button>
              )}
              {(preview || props.readOnly) && (
                <section
                  aria-label={t('Markdown preview')}
                  className='min-w-0 rounded-md border p-4'
                >
                  <TutorialContent content={form.watch('content_markdown')} />
                </section>
              )}
            </>
          )}
          {form.formState.errors.root?.server && (
            <p role='alert' className='text-destructive text-sm'>
              {form.formState.errors.root.server.message}
            </p>
          )}
          {!props.readOnly && (
            <p className='text-muted-foreground text-sm'>
              {t(
                'Saved changes are visible immediately. Disabled content is hidden from readers.'
              )}
            </p>
          )}
        </SideDrawerSection>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <Button
            type='button'
            variant='outline'
            onClick={props.onClose}
            disabled={mutation.isPending}
          >
            {t(props.readOnly ? 'Close' : 'Cancel')}
          </Button>
          {!props.readOnly && (
            <Button type='submit' disabled={mutation.isPending}>
              {t(mutation.isPending ? 'Saving...' : 'Save')}
            </Button>
          )}
        </SheetFooter>
      </form>
    </Form>
  )
}

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import {
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { getPointTypes } from '@/features/points/api'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { saveCampaign, type Campaign } from './api'

const editorSchema = z
  .object({
    code: z.string().trim().min(1),
    period: z.number().int().positive(),
    name: z.string().trim().min(1),
    description: z.string(),
    rules_text: z.string(),
    visible: z.boolean(),
    start: z.string().min(1),
    end: z.string().min(1),
    freeze_days: z.number().int().min(1).max(365),
    reward_point_type_id: z.string().min(1),
    tiers: z
      .array(
        z.object({
          min_effective_friends: z.number().int().nonnegative(),
          rate_bps: z.number().int().min(0).max(10000),
        })
      )
      .min(1),
  })
  .refine((v) => new Date(v.end).getTime() > new Date(v.start).getTime(), {
    path: ['end'],
    message: 'End time must be after start time',
  })
  .refine(
    (v) =>
      v.tiers.every((tier, i) =>
        i === 0
          ? tier.min_effective_friends === 0
          : tier.min_effective_friends > v.tiers[i - 1].min_effective_friends
      ),
    {
      path: ['tiers'],
      message: 'Tier thresholds must start at zero and increase',
    }
  )
type EditorValues = z.infer<typeof editorSchema>

export function CampaignEditor(props: {
  campaign: Campaign | null
  copy: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const source = props.campaign
  const editing = source && !props.copy ? source : undefined
  const form = useForm<EditorValues>({
    resolver: zodResolver(editorSchema),
    mode: 'onChange',
    defaultValues: {
      code: source ? `${source.code}${props.copy ? '-next' : ''}` : '',
      period: source ? source.period + (props.copy ? 1 : 0) : 1,
      name: source?.name ?? '',
      description: source?.description ?? '',
      rules_text: source?.rules_text ?? '',
      visible: source?.visible ?? true,
      start: source && !props.copy ? toLocal(source.starts_at) : '',
      end: source && !props.copy ? toLocal(source.ends_at) : '',
      freeze_days: source?.freeze_days ?? 7,
      reward_point_type_id: source?.reward_point_type_id ?? '',
      tiers: source?.tiers ?? [
        { min_effective_friends: 0, rate_bps: 500 },
        { min_effective_friends: 3, rate_bps: 700 },
        { min_effective_friends: 9, rate_bps: 1000 },
      ],
    },
  })
  const fields = useFieldArray({ control: form.control, name: 'tiers' })
  const values = form.watch()
  const types = useQuery({
    queryKey: ['points', 'types'],
    queryFn: getPointTypes,
  })
  const save = useMutation({
    mutationFn: (v: EditorValues) =>
      saveCampaign(
        {
          code: v.code,
          period: v.period,
          name: v.name,
          description: v.description,
          rules_text: v.rules_text,
          visible: v.visible,
          starts_at: String(new Date(v.start).getTime()),
          ends_at: String(new Date(v.end).getTime()),
          freeze_days: v.freeze_days,
          reward_point_type_id: v.reward_point_type_id,
          tiers: v.tiers,
        },
        editing
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invitation', 'admin'] })
      props.onClose()
    },
  })
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) props.onClose()
      }}
    >
      <SheetContent
        side='right'
        className={sideDrawerContentClassName('sm:max-w-2xl')}
      >
        <SheetHeader className={sideDrawerHeaderClassName('pr-12')}>
          <SheetTitle>
            {editing ? t('Edit campaign') : t('New campaign')}
          </SheetTitle>
          <SheetDescription>
            {t('Time zone')}: {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </SheetDescription>
        </SheetHeader>
        <form
          id='invitation-campaign-editor'
          className={sideDrawerFormClassName()}
          onSubmit={form.handleSubmit((v) => save.mutate(v))}
        >
          <fieldset disabled={save.isPending} className='space-y-6'>
            <label className='flex items-center gap-2 text-sm'>
              <Checkbox
                checked={values.visible}
                onCheckedChange={(v) =>
                  form.setValue('visible', v, { shouldValidate: true })
                }
              />
              <span>{t('Visible')}</span>
            </label>
            <div
              className='grid gap-4 sm:grid-cols-2'
              data-slot='campaign-fields'
            >
              <label>
                <span className='mb-1 block text-sm'>{t('Campaign code')}</span>
                <Input {...form.register('code')} />
              </label>
              <label>
                <span className='mb-1 block text-sm'>
                  {t('Campaign period')}
                </span>
                <Input
                  type='number'
                  min='1'
                  {...form.register('period', { valueAsNumber: true })}
                />
              </label>
              <label className='sm:col-span-2'>
                <span className='mb-1 block text-sm'>{t('Campaign name')}</span>
                <Input {...form.register('name')} />
              </label>
              <label>
                <span className='mb-1 block text-sm'>{t('Freeze days')}</span>
                <Input
                  type='number'
                  min='1'
                  max='365'
                  {...form.register('freeze_days', { valueAsNumber: true })}
                />
              </label>
              <div
                className='grid gap-4 sm:col-span-2 sm:grid-cols-2'
                data-slot='campaign-dates'
              >
                <label>
                  <span className='mb-1 block text-sm'>{t('Starts at')}</span>
                  <Input type='datetime-local' {...form.register('start')} />
                </label>
                <label>
                  <span className='mb-1 block text-sm'>{t('Ends at')}</span>
                  <Input type='datetime-local' {...form.register('end')} />
                </label>
              </div>
              <label className='sm:col-span-2'>
                <span className='mb-1 block text-sm'>{t('Description')}</span>
                <Textarea {...form.register('description')} />
              </label>
              <label className='sm:col-span-2'>
                <span className='mb-1 block text-sm'>
                  {t('Campaign rules')}
                </span>
                <Textarea rows={4} {...form.register('rules_text')} />
              </label>
            </div>
            <section className='space-y-4 border-t pt-5'>
              <h3 className='font-semibold'>{t('Reward tiers')}</h3>
              <p className='text-muted-foreground text-sm'>
                {t('Effective friends determine your reward rate')} ·{' '}
                {t('100 basis points = 1%')}
              </p>
              <label className='block'>
                <span className='mb-1 block text-sm'>
                  {t('Reward point type')}
                </span>
                <Select
                  value={values.reward_point_type_id}
                  onValueChange={(v) =>
                    form.setValue('reward_point_type_id', v ?? '', {
                      shouldValidate: true,
                    })
                  }
                  items={
                    types.data?.map((pt) => ({
                      value: String(pt.id),
                      label: `${pt.name} (${pt.code})`,
                    })) ?? []
                  }
                >
                  <SelectTrigger
                    aria-label={t('Reward point type')}
                    className='w-full'
                  >
                    <SelectValue placeholder={t('Select point type')} />
                  </SelectTrigger>
                  <SelectContent>
                    {types.data?.map((pt) => (
                      <SelectItem key={pt.id} value={String(pt.id)}>
                        {pt.name} ({pt.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              {types.isError && (
                <ErrorState
                  description={getServerErrorMessage(types.error)}
                  onRetry={() => void types.refetch()}
                />
              )}
              {fields.fields.map((field, i) => (
                <div
                  key={field.id}
                  className='flex flex-wrap items-end gap-3 rounded-lg border p-3'
                >
                  <label className='min-w-36 flex-1'>
                    <span className='mb-1 block text-xs'>
                      {t('Minimum effective friends')}
                    </span>
                    <Input
                      type='number'
                      min='0'
                      {...form.register(`tiers.${i}.min_effective_friends`, {
                        valueAsNumber: true,
                      })}
                    />
                  </label>
                  <label className='min-w-36 flex-1'>
                    <span className='mb-1 block text-xs'>
                      {t('Reward basis points')}
                    </span>
                    <Input
                      type='number'
                      min='0'
                      max='10000'
                      {...form.register(`tiers.${i}.rate_bps`, {
                        valueAsNumber: true,
                      })}
                    />
                  </label>
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => fields.remove(i)}
                  >
                    {t('Remove')}
                  </Button>
                </div>
              ))}
              <p className='text-muted-foreground text-sm'>
                {t('Reward preview for CNY 100')}:{' '}
                {values.tiers
                  .map(
                    (tier) =>
                      `${tier.min_effective_friends}+: ${Number.isInteger(tier.rate_bps) && tier.rate_bps >= 0 && tier.rate_bps <= 10000 ? tier.rate_bps * 10 : '-'}`
                  )
                  .join(' / ')}
              </p>
              <Button
                type='button'
                variant='outline'
                onClick={() =>
                  fields.append({
                    min_effective_friends:
                      (values.tiers.at(-1)?.min_effective_friends ?? -1) + 1,
                    rate_bps: 500,
                  })
                }
              >
                {t('Add tier')}
              </Button>
            </section>
            {form.formState.errors.end && (
              <p role='alert' className='text-destructive text-sm'>
                {t(
                  form.formState.errors.end.message ??
                    'Invalid invitation parameters'
                )}
              </p>
            )}
            {form.formState.errors.tiers && (
              <p role='alert' className='text-destructive text-sm'>
                {t('Tier thresholds must start at zero and increase')}
              </p>
            )}
            {save.isError && (
              <ErrorState description={getServerErrorMessage(save.error)} />
            )}
          </fieldset>
        </form>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <Button
            variant='outline'
            disabled={save.isPending}
            onClick={props.onClose}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='submit'
            form='invitation-campaign-editor'
            disabled={
              !form.formState.isValid || save.isPending || types.isError
            }
          >
            {t('Save')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
function toLocal(value: string) {
  const d = new Date(Number(value))
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}

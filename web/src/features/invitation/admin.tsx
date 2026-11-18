import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { getPointTypes } from '@/features/points/api'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  getAdminCampaigns,
  saveCampaign,
  campaignAction,
  type Campaign,
} from './api'
import { PageControls } from './page-controls'
import { InvitationRefundAdmin } from './refund-admin'
import { InvitationRewardAdmin } from './reward-admin'

export function InvitationCampaignAdmin() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const viewer = useAuthStore((s) => s.auth.user?.id)
  const [page, setPage] = useState(1)
  const q = useQuery({
    queryKey: ['invitation', 'admin', viewer, page],
    queryFn: () => getAdminCampaigns(page),
  })
  const [editing, setEditing] = useState<Campaign | null>(null)
  const [name, setName] = useState('')
  const [freeze, setFreeze] = useState('7')
  const [type, setType] = useState('')
  const [period, setPeriod] = useState('1')
  const [code, setCode] = useState('')
  const [visible, setVisible] = useState(true)
  const [description, setDescription] = useState('')
  const [rules, setRules] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [tierKeys, setTierKeys] = useState(() => [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ])
  const [tiers, setTiers] = useState([
    { min_effective_friends: 0, rate_bps: 500 },
    { min_effective_friends: 3, rate_bps: 700 },
    { min_effective_friends: 9, rate_bps: 1000 },
  ])
  const types = useQuery({
    queryKey: ['points', 'types'],
    queryFn: getPointTypes,
  })
  const save = useMutation({
    mutationFn: () =>
      saveCampaign(
        {
          code,
          period: Number(period),
          name,
          description,
          starts_at: String(new Date(start).getTime()),
          ends_at: String(new Date(end).getTime()),
          reward_point_type_id: type,
          freeze_days: Number(freeze),
          tiers,
          rules_text: rules,
          visible,
        },
        editing ?? undefined
      ),
    onSuccess: () => {
      setEditing(null)
      setName('')
      void qc.invalidateQueries({ queryKey: ['invitation', 'admin'] })
    },
  })
  const action = useMutation({
    mutationFn: ({ c, a }: { c: Campaign; a: 'publish' | 'end' }) =>
      campaignAction(c, a),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['invitation', 'admin'] }),
  })
  return (
    <SectionPageLayout variant='default'>
      <SectionPageLayout.Title>
        {t('Invitation campaigns')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='mx-auto flex w-full max-w-6xl flex-col gap-6'>
          {q.isPending && <LoadingState />}
          {q.isError && <ErrorState onRetry={() => void q.refetch()} />}
          {types.isError && (
            <ErrorState
              description={getServerErrorMessage(types.error)}
              onRetry={() => void types.refetch()}
            />
          )}
          <header className='border-border/60 bg-muted/20 rounded-xl border px-5 py-4'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
              <div>
                <p className='text-muted-foreground text-sm'>
                  {t('Invitation campaigns')}
                </p>
                <h2 className='mt-1 text-xl font-semibold tracking-tight'>
                  {editing ? t('Edit campaign') : t('New campaign')}
                </h2>
              </div>
              <span className='text-muted-foreground rounded-full border px-3 py-1 text-xs'>
                {t('Time zone')}:{' '}
                {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </span>
            </div>
          </header>
          <section className='rounded-xl border p-5 shadow-xs'>
            <div className='flex flex-wrap items-baseline justify-between gap-2'>
              <label className='flex items-center gap-2 text-sm'>
                <Checkbox checked={visible} onCheckedChange={setVisible} />
                <span>{t('Visible')}</span>
              </label>
            </div>
            <div
              className='mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3'
              data-slot='campaign-fields'
            >
              <label>
                <span className='text-muted-foreground mb-1 block text-xs'>
                  {t('Campaign code')}
                </span>
                <Input
                  aria-label={t('Campaign code')}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t('Campaign code')}
                />
              </label>
              <label>
                <span className='text-muted-foreground mb-1 block text-xs'>
                  {t('Campaign period')}
                </span>
                <Input
                  type='number'
                  aria-label={t('Campaign period')}
                  placeholder={t(
                    'Campaign period (e.g. 1 for the first campaign)'
                  )}
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                />
              </label>
              <label>
                <span className='text-muted-foreground mb-1 block text-xs'>
                  {t('Campaign name')}
                </span>
                <Input
                  aria-label={t('Campaign name')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('Campaign name')}
                />
              </label>
              <label>
                <span className='text-muted-foreground mb-1 block text-xs'>
                  {t('Freeze days')}
                </span>
                <Input
                  aria-label={t('Freeze days')}
                  type='number'
                  min='1'
                  max='365'
                  value={freeze}
                  onChange={(e) => setFreeze(e.target.value)}
                  placeholder={t('Freeze days')}
                />
              </label>
              <label>
                <span className='text-muted-foreground mb-1 block text-xs'>
                  {t('Starts at')}
                </span>
                <Input
                  type='datetime-local'
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                <span className='text-muted-foreground mb-1 block text-xs'>
                  {t('Ends at')}
                </span>
                <Input
                  type='datetime-local'
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
              <label className='sm:col-span-2 lg:col-span-1'>
                <span className='text-muted-foreground mb-1 block text-xs'>
                  {t('Description')}
                </span>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label className='sm:col-span-2'>
                <span className='text-muted-foreground mb-1 block text-xs'>
                  {t('Campaign rules')}
                </span>
                <textarea
                  className='w-full rounded border p-2'
                  value={rules}
                  onChange={(e) => setRules(e.target.value)}
                />
              </label>
            </div>
            <div className='border-border/60 bg-muted/20 mt-6 rounded-lg border p-4'>
              <div className='flex flex-wrap items-baseline justify-between gap-2'>
                <div>
                  <h3 className='font-semibold'>{t('Reward tiers')}</h3>
                  <p className='text-muted-foreground mt-1 text-sm'>
                    {t('Effective friends determine your reward rate')}
                  </p>
                </div>
                <span className='text-muted-foreground text-xs'>
                  {t('100 basis points = 1%')}
                </span>
              </div>
              <label className='mt-4 block max-w-sm'>
                <span className='text-muted-foreground mb-1 block text-xs'>
                  {t('Reward point type')}
                </span>
                <select
                  className='bg-background w-full rounded-md border p-2'
                  aria-label={t('Reward point type')}
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  <option value=''>{t('Select point type')}</option>
                  {types.data?.map((pt) => (
                    <option key={pt.id} value={String(pt.id)}>
                      {pt.name} ({pt.code})
                    </option>
                  ))}
                </select>
              </label>
              <div className='mt-4 space-y-3'>
                {tiers.map((tier, i) => (
                  <div
                    className='bg-background flex flex-wrap items-end gap-3 rounded-lg border p-3'
                    key={tierKeys[i]}
                  >
                    <span className='text-muted-foreground w-6 pb-2 text-sm font-semibold'>
                      {i + 1}
                    </span>
                    <label className='min-w-36 flex-1'>
                      <span className='text-muted-foreground mb-1 block text-xs'>
                        {t('Minimum effective friends')}
                      </span>
                      <Input
                        aria-label={t('Minimum effective friends')}
                        type='number'
                        min='0'
                        value={tier.min_effective_friends}
                        onChange={(e) =>
                          setTiers(
                            tiers.map((v, j) =>
                              j === i
                                ? {
                                    ...v,
                                    min_effective_friends: Number(
                                      e.target.value
                                    ),
                                  }
                                : v
                            )
                          )
                        }
                      />
                    </label>
                    <label className='min-w-36 flex-1'>
                      <span className='text-muted-foreground mb-1 block text-xs'>
                        {t('Reward basis points')}
                      </span>
                      <Input
                        aria-label={t('Reward basis points')}
                        type='number'
                        min='0'
                        max='10000'
                        value={tier.rate_bps}
                        onChange={(e) =>
                          setTiers(
                            tiers.map((v, j) =>
                              j === i
                                ? { ...v, rate_bps: Number(e.target.value) }
                                : v
                            )
                          )
                        }
                      />
                    </label>
                    <Button
                      variant='outline'
                      onClick={() => {
                        setTiers(tiers.filter((_, j) => j !== i))
                        setTierKeys(tierKeys.filter((_, j) => j !== i))
                      }}
                    >
                      {t('Remove')}
                    </Button>
                  </div>
                ))}
              </div>
              <p className='text-muted-foreground mt-4 text-sm'>
                {t('Reward preview for CNY 100')}:{' '}
                {tiers.map(formatInvitationTierPreview).join(' / ')}
              </p>
              <Button
                variant='outline'
                onClick={() => {
                  setTierKeys([...tierKeys, crypto.randomUUID()])
                  setTiers([
                    ...tiers,
                    { min_effective_friends: 0, rate_bps: 500 },
                  ])
                }}
              >
                {t('Add tier')}
              </Button>
            </div>
            <Button
              className='mt-5'
              onClick={() => save.mutate()}
              disabled={
                !name ||
                !code ||
                !type ||
                !start ||
                !end ||
                !tiers.length ||
                tiers.some((tier) => !isValidInvitationTier(tier)) ||
                save.isPending
              }
            >
              {t('Save')}
            </Button>
          </section>
          {(save.isError || action.isError) && (
            <ErrorState
              description={getServerErrorMessage(save.error ?? action.error)}
            />
          )}
          <section className='rounded-xl border p-5 shadow-xs'>
            <div className='mb-4 flex flex-wrap items-baseline justify-between gap-2'>
              <div>
                <h3 className='font-semibold'>{t('Campaign history')}</h3>
              </div>
              <span className='text-muted-foreground text-sm'>
                {q.data?.total ?? '0'}
              </span>
            </div>
            {q.data?.items.map((c) => (
              <div
                key={c.id}
                className='border-border/60 flex flex-col gap-3 border-b py-4 last:border-b-0 lg:flex-row lg:items-center lg:justify-between'
              >
                <div className='min-w-0'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <strong className='truncate'>{c.name}</strong>
                    <span className='rounded-full border px-2 py-0.5 text-xs'>
                      {t(c.status)}
                    </span>
                    <span className='text-muted-foreground text-xs'>
                      {c.freeze_days}
                      {t(' days')}
                    </span>
                  </div>
                  <span className='text-muted-foreground mt-1 block text-sm'>
                    {new Date(Number(c.starts_at)).toLocaleString()} –{' '}
                    {new Date(Number(c.ends_at)).toLocaleString()}
                  </span>
                  {c.status === 'draft' && Number(c.ends_at) <= Date.now() && (
                    <span className='text-destructive mt-1 block text-sm'>
                      {t(
                        'Campaign end time has passed. Set a future end time.'
                      )}
                    </span>
                  )}
                </div>
                <div className='flex flex-wrap gap-2'>
                  <Button
                    disabled={c.status !== 'draft'}
                    variant='outline'
                    onClick={() => {
                      setEditing(c)
                      setName(c.name)
                      setFreeze(String(c.freeze_days))
                      setCode(c.code)
                      setVisible(c.visible)
                      setPeriod(String(c.period))
                      setType(c.reward_point_type_id)
                      setDescription(c.description)
                      setRules(c.rules_text)
                      setTiers(c.tiers)
                      setTierKeys(c.tiers.map(() => crypto.randomUUID()))
                      setStart(toLocal(c.starts_at))
                      setEnd(c.ends_at ? toLocal(c.ends_at) : '')
                    }}
                  >
                    {t('Edit')}
                  </Button>
                  <Button
                    variant='outline'
                    onClick={() => {
                      setEditing(null)
                      setCode(`${c.code}-next`)
                      setPeriod(String(c.period + 1))
                      setName(c.name)
                      setFreeze(String(c.freeze_days))
                      setType(c.reward_point_type_id)
                      setDescription(c.description)
                      setRules(c.rules_text)
                      setTiers(c.tiers)
                      setTierKeys(c.tiers.map(() => crypto.randomUUID()))
                      setStart('')
                      setEnd('')
                    }}
                  >
                    {t('Copy to next campaign')}
                  </Button>
                  {c.status === 'draft' && (
                    <Button onClick={() => action.mutate({ c, a: 'publish' })}>
                      {t('Publish')}
                    </Button>
                  )}
                  {(c.published_version != null ||
                    c.status === 'active' ||
                    c.status === 'upcoming') && (
                    <Button
                      variant='destructive'
                      onClick={() => action.mutate({ c, a: 'end' })}
                    >
                      {t('End')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <PageControls
              page={page}
              total={q.data?.total ?? '0'}
              onChange={setPage}
            />
          </section>
          <InvitationRewardAdmin />
          <InvitationRefundAdmin />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function isValidInvitationTier(tier: {
  min_effective_friends: number
  rate_bps: number
}) {
  return (
    Number.isInteger(tier.min_effective_friends) &&
    tier.min_effective_friends >= 0 &&
    Number.isInteger(tier.rate_bps) &&
    tier.rate_bps >= 0 &&
    tier.rate_bps <= 10000
  )
}

function formatInvitationTierPreview(tier: {
  min_effective_friends: number
  rate_bps: number
}) {
  return `${tier.min_effective_friends}+: ${isValidInvitationTier(tier) ? tier.rate_bps * 10 : '-'}`
}

function toLocal(value: string) {
  const d = new Date(Number(value))
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}

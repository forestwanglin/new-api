import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  getServerErrorMessage,
  getServerErrorSources,
} from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'

import {
  bindInvitation,
  getBinding,
  getCampaigns,
  getCurrentCampaign,
  getFriends,
  getLink,
  getRewards,
  getSummary,
  formatPoints,
  formatMoneyMinor,
} from './api'
import {
  clearBindingIntent,
  readBindingIntent,
  saveBindingIntent,
} from './intent'
import { PageControls } from './page-controls'

export function InvitationPage({
  initialInvitation = '',
}: {
  initialInvitation?: string
}) {
  const { t } = useTranslation()
  const auth = useAuthStore((s) => s.auth)
  const user = auth.user
  const fullAuth = !!user && !!auth.session && !auth.pendingLoginVerification
  const loginOpen = useLoginModalStore((s) => s.isOpen)
  const qc = useQueryClient()
  const previousUser = useRef(user?.id)
  const previousLoginOpen = useRef(loginOpen)
  const [input, setInput] = useState(
    () => readBindingIntent() || initialInvitation
  )
  const [friendsPage, setFriendsPage] = useState(1)
  const [rewardsPage, setRewardsPage] = useState(1)
  const [campaignsPage, setCampaignsPage] = useState(1)
  const [boundDialog, setBoundDialog] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(false)
  const [message, setMessage] = useState('')
  const campaigns = useQuery({
    queryKey: ['invitation', 'campaigns', campaignsPage],
    queryFn: () => getCampaigns(campaignsPage),
  })
  const campaign = useQuery({
    queryKey: ['invitation', 'campaign'],
    queryFn: getCurrentCampaign,
  })
  const link = useQuery({
    queryKey: ['invitation', 'link', user?.id],
    queryFn: getLink,
    enabled: fullAuth,
  })
  const binding = useQuery({
    queryKey: ['invitation', 'binding', user?.id],
    queryFn: getBinding,
    enabled: fullAuth,
  })
  const summary = useQuery({
    queryKey: ['invitation', 'summary', user?.id],
    queryFn: getSummary,
    enabled: fullAuth,
  })
  const friends = useQuery({
    queryKey: ['invitation', 'friends', user?.id, friendsPage],
    queryFn: () => getFriends(friendsPage),
    enabled: fullAuth,
  })
  const rewards = useQuery({
    queryKey: ['invitation', 'rewards', user?.id, rewardsPage],
    queryFn: () => getRewards(rewardsPage),
    enabled: fullAuth,
  })
  const bind = useMutation({
    mutationFn: ({
      invitation,
      requestId,
    }: {
      invitation: string
      requestId: string
      viewer: number
    }) => bindInvitation(invitation, requestId),
    onSuccess: (_, variables) => {
      if (useAuthStore.getState().auth.user?.id !== variables.viewer) return
      setMessage(t('Invitation binding succeeded'))
      clearBindingIntent()
      void qc.invalidateQueries({
        queryKey: ['invitation'],
      })
      setConfirmDialog(false)
    },
    onError: (error, variables) => {
      if (useAuthStore.getState().auth.user?.id !== variables.viewer) return
      setConfirmDialog(false)
      if (
        getServerErrorSources(error).some((s) => s.code === 'ALREADY_BOUND')
      ) {
        setBoundDialog(true)
      }
      setMessage(getServerErrorMessage(error))
      void binding.refetch()
    },
  })
  const confirm = () => {
    if (fullAuth && binding.data?.bound) {
      setBoundDialog(true)
      return
    }
    if (!input.trim()) return
    if (!fullAuth) {
      saveBindingIntent(input.trim())
      useLoginModalStore.getState().open({ redirectTo: '/invite' })
      return
    }
    if (!binding.isSuccess) return
    if (binding.data.bound) {
      setBoundDialog(true)
      return
    }
    setConfirmDialog(true)
  }
  useEffect(() => {
    if (previousUser.current && previousUser.current !== user?.id) {
      clearBindingIntent()
      setInput('')
      setMessage('')
      setBoundDialog(false)
      setConfirmDialog(false)
      setFriendsPage(1)
      setRewardsPage(1)
    }
    previousUser.current = user?.id
    if (fullAuth && readBindingIntent()) {
      setInput(readBindingIntent())
    }
    if (previousLoginOpen.current && !loginOpen && !fullAuth) {
      clearBindingIntent()
    }
    previousLoginOpen.current = loginOpen
  }, [user?.id, fullAuth, loginOpen])
  const privateQueries = [link, binding, summary, friends, rewards]
  return (
    <SectionPageLayout variant='user'>
      <SectionPageLayout.Title>{t('Invite friends')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='mx-auto flex w-full max-w-5xl flex-col gap-5'>
          {campaign.isPending && <LoadingState />}
          {campaign.isError && (
            <ErrorState
              description={t('Unable to load invitation campaign')}
              onRetry={() => void campaign.refetch()}
            />
          )}
          {campaign.isSuccess && !campaign.data && (
            <p>{t('No active invitation campaign')}</p>
          )}
          {campaign.data && (
            <section className='rounded-lg border p-5'>
              <h2 className='text-xl font-semibold'>{campaign.data.name}</h2>
              <p className='whitespace-pre-wrap'>{campaign.data.description}</p>
              <p>
                {t('Freeze period')}: {campaign.data.freeze_days} {t('days')} ·{' '}
                {campaign.data.reward_point_type.name}
              </p>
              <div className='mt-3 flex flex-wrap gap-2'>
                {campaign.data.tiers.map((tier) => (
                  <span
                    key={tier.min_effective_friends}
                    className='rounded border px-2 py-1'
                  >
                    {tier.min_effective_friends}+ {t('friends')}:{' '}
                    {(tier.rate_bps / 100).toFixed(2)}%
                  </span>
                ))}
              </div>
              <p className='mt-3 whitespace-pre-wrap'>
                {campaign.data.rules_text}
              </p>
            </section>
          )}
          <p className='text-muted-foreground text-sm'>
            {t(
              'Only invitation rewards are frozen; purchased subscription points are available immediately.'
            )}
          </p>
          <Dialog
            open={confirmDialog}
            onOpenChange={setConfirmDialog}
            title={t('Confirm permanent inviter binding')}
          >
            <p>{t('Binding is permanent and cannot be changed or removed.')}</p>
            <p className='break-all'>{input}</p>
            <Button
              disabled={bind.isPending}
              onClick={() =>
                bind.mutate({
                  invitation: input.trim(),
                  requestId: crypto.randomUUID(),
                  viewer: user?.id ?? 0,
                })
              }
            >
              {t('Bind permanently')}
            </Button>
          </Dialog>
          <Dialog
            open={boundDialog}
            onOpenChange={setBoundDialog}
            title={t('Bound inviter')}
          >
            <p>{t('You have already bound an inviter')}</p>
          </Dialog>
          <section className='rounded-lg border p-5'>
            <h2 className='font-semibold'>{t('Bind inviter')}</h2>
            <div className='mt-3 flex flex-col gap-2 sm:flex-row'>
              <Input
                aria-label={t('Paste invitation link')}
                maxLength={2048}
                readOnly={binding.data?.bound === true}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t('Paste invitation link')}
              />
              <Button
                onClick={confirm}
                disabled={
                  bind.isPending ||
                  (!input.trim() && !binding.data?.bound) ||
                  (fullAuth && !binding.isSuccess)
                }
              >
                {t('Confirm binding')}
              </Button>
            </div>
            {binding.data?.bound && (
              <p className='mt-2 text-sm'>
                {t('Bound inviter')}: {binding.data.inviter_label}
              </p>
            )}
            {message && (
              <p className='mt-2' role='status'>
                {message}
              </p>
            )}
          </section>
          {fullAuth && (
            <>
              {privateQueries.some((q) => q.isPending) && <LoadingState />}
              {privateQueries.some((q) => q.isError) && (
                <ErrorState
                  onRetry={() => {
                    for (const q of privateQueries) void q.refetch()
                  }}
                />
              )}
              <section className='rounded-lg border p-5'>
                <h2 className='font-semibold'>{t('My invitation link')}</h2>
                <p className='break-all'>{link.data?.url}</p>
                <p>{link.data?.code}</p>
                <Button
                  disabled={!link.data}
                  onClick={() => {
                    if (link.data) {
                      void navigator.clipboard.writeText(link.data.url).then(
                        () => setMessage(t('Invitation link copied')),
                        () => setMessage(t('Unable to copy invitation link'))
                      )
                    }
                  }}
                >
                  {t('Copy invitation link')}
                </Button>
                {summary.data && (
                  <>
                    <p className='mt-3'>
                      {t('Bound friends')}:{' '}
                      {formatPoints(summary.data.bound_friends)} ·{' '}
                      {t('Effective friends')}:{' '}
                      {formatPoints(summary.data.effective_friends)} ·{' '}
                      {t('Pending friends')}:{' '}
                      {formatPoints(summary.data.pending_friends)} ·{' '}
                      {t('Current rate')}:{' '}
                      {summary.data.current_rate_bps == null
                        ? '-'
                        : `${summary.data.current_rate_bps / 100}%`}
                    </p>
                    {summary.data.next_threshold != null && (
                      <p>
                        {t('Next tier at {{count}} effective friends', {
                          count: summary.data.next_threshold,
                        })}
                        {' · '}
                        {t('Friends needed for next tier')}:{' '}
                        {formatPoints(
                          (BigInt(summary.data.next_threshold) -
                            BigInt(summary.data.effective_friends) >
                          0n
                            ? BigInt(summary.data.next_threshold) -
                              BigInt(summary.data.effective_friends)
                            : 0n
                          ).toString()
                        )}
                      </p>
                    )}
                    {summary.data.next_threshold === null &&
                      summary.data.current_rate_bps !== null && (
                        <p>{t('Highest reward tier reached')}</p>
                      )}
                    {summary.data.balances.map((b) => (
                      <p key={b.point_type_id}>
                        {b.name}: {formatPoints(b.released_total)}{' '}
                        {t('released')}, {formatPoints(b.frozen_points)}{' '}
                        {t('frozen')}, {formatPoints(b.processing_points)}{' '}
                        {t('Processing')} · {t('Total pending')}:{' '}
                        {formatPoints(b.pending_total)} · {t('Cancelled')}:{' '}
                        {formatPoints(b.cancelled_total)} · {t('Reversed')}:{' '}
                        {formatPoints(b.reversed_total)}
                      </p>
                    ))}
                  </>
                )}
              </section>
              <section className='rounded-lg border p-5'>
                <h2 className='font-semibold'>{t('Friends')}</h2>
                {friends.isSuccess &&
                  (friends.data.items.length ? (
                    friends.data.items.map((f) => (
                      <div className='border-b py-2' key={f.invitee_id}>
                        <p>
                          {f.label} · {t(f.status)}
                        </p>
                        <p className='text-muted-foreground text-sm'>
                          {t('Bound at')}: {formatTime(f.bound_at)} ·{' '}
                          {t('Qualified at')}: {formatTime(f.qualified_at)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p>{t('No invited friends yet')}</p>
                  ))}
                <PageControls
                  page={friendsPage}
                  total={friends.data?.total ?? '0'}
                  onChange={setFriendsPage}
                />
              </section>
              <section className='rounded-lg border p-5'>
                <h2 className='font-semibold'>{t('Reward history')}</h2>
                {rewards.isSuccess &&
                  (rewards.data.items.length ? (
                    rewards.data.items.map((r) => (
                      <article key={r.id} className='space-y-1 border-b py-3'>
                        <p>
                          {r.order_label} · {r.invitee_label} ·{' '}
                          {r.campaign_name} · v{r.campaign_version}
                        </p>
                        <p>
                          {r.point_type.name}: {formatPoints(r.original_points)}{' '}
                          · {t(r.status)}
                        </p>
                        <p>
                          {t('Net paid')}: ¥
                          {formatMoneyMinor(r.net_paid_amount_minor)} ·{' '}
                          {r.rate_bps / 100}%
                        </p>
                        <p>
                          {t('Processing')}: {formatPoints(r.processing_points)}{' '}
                          · {t('Frozen')}: {formatPoints(r.frozen_points)} ·{' '}
                          {t('Released invitation points')}:{' '}
                          {formatPoints(r.released_points)} · {t('Cancelled')}:{' '}
                          {formatPoints(r.cancelled_points)} · {t('Reversed')}:{' '}
                          {formatPoints(r.reversed_points)}
                        </p>
                        <p className='text-muted-foreground text-sm'>
                          {t('Paid at')}: {formatTime(r.paid_at)} ·{' '}
                          {t('Release at')}: {formatTime(r.release_at)}
                        </p>
                      </article>
                    ))
                  ) : (
                    <p>{t('No rewards yet')}</p>
                  ))}
                <PageControls
                  page={rewardsPage}
                  total={rewards.data?.total ?? '0'}
                  onChange={setRewardsPage}
                />
              </section>
            </>
          )}
          <section className='rounded-lg border p-5'>
            <h2 className='font-semibold'>{t('Campaign history')}</h2>
            {campaigns.isPending && <LoadingState />}
            {campaigns.isError && (
              <ErrorState onRetry={() => void campaigns.refetch()} />
            )}
            {campaigns.isSuccess &&
              (campaigns.data.items.length ? (
                campaigns.data.items.map((c) => (
                  <details key={c.id} className='border-b py-3'>
                    <summary>
                      {c.name} · {t(c.status)}
                    </summary>
                    <p className='whitespace-pre-wrap'>{c.description}</p>
                    <p>
                      {formatTime(c.starts_at)} — {formatTime(c.ends_at)}
                    </p>
                    <p className='whitespace-pre-wrap'>{c.rules_text}</p>
                  </details>
                ))
              ) : (
                <p>{t('No invitation campaigns')}</p>
              ))}
            <PageControls
              page={campaignsPage}
              total={campaigns.data?.total ?? '0'}
              onChange={setCampaignsPage}
            />
          </section>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
function formatTime(value: string | null) {
  return value == null ? '—' : new Date(Number(value)).toLocaleString()
}

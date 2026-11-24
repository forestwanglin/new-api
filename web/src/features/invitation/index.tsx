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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'

import '@/styles/invitation.css'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePointName } from '@/features/points/lib/point-name-context'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import {
  getServerErrorMessage,
  getServerErrorSources,
} from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'

import { ActivityDialog } from './activity-dialog'
import {
  bindInvitation,
  getBinding,
  getCurrentCampaign,
  getLink,
  getRewards,
  getSummary,
  formatPoints,
} from './api'
import { CampaignPanel } from './campaign-panel'
import {
  clearBindingIntent,
  readBindingIntent,
  saveBindingIntent,
} from './intent'
import { RewardHistory } from './reward-history'

export function InvitationPage({
  initialInvitation = '',
}: {
  initialInvitation?: string
}) {
  const { t } = useTranslation()
  const pointName = usePointName()
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
  const [rewardsPage, setRewardsPage] = useState(1)
  const [activitiesOpen, setActivitiesOpen] = useState(false)
  const [boundDialog, setBoundDialog] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(false)
  const [message, setMessage] = useState('')
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
  const inviterName =
    binding.data?.inviter_name || binding.data?.inviter_label || ''
  const summary = useQuery({
    queryKey: ['invitation', 'summary', user?.id],
    queryFn: getSummary,
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
  const privateQueries = [link, binding, summary]
  const copy = useCopyToClipboard()
  const loginForInvite = () => {
    if (input.trim()) saveBindingIntent(input.trim())
    useLoginModalStore.getState().open({ redirectTo: '/invite' })
  }
  return (
    <main className='invitation-page'>
      <div className='invite-wrap'>
        <div className='iv-page-head'>
          <h1>{t('Invite friends and earn points')}</h1>
          <p>
            {t(
              'Share useful models with friends. View subscription rewards and invitation progress here.'
            )}
          </p>
        </div>
        {campaign.isPending && <LoadingState />}
        {campaign.isError && (
          <ErrorState
            description={t('Unable to load invitation campaign')}
            onRetry={() => void campaign.refetch()}
          />
        )}
        {campaign.isSuccess && (
          <CampaignPanel
            campaign={campaign.data}
            authenticated={fullAuth}
            summaryPending={summary.isPending}
            summary={fullAuth ? summary.data : undefined}
            onActivities={() => setActivitiesOpen(true)}
            share={
              <>
                <Button
                  className='iv-primary'
                  disabled={fullAuth && !link.data}
                  onClick={() => {
                    if (fullAuth && link.data) {
                      void copy.copyToClipboard(link.data.url)
                    } else loginForInvite()
                  }}
                >
                  {fullAuth
                    ? t(
                        copy.copiedText === link.data?.url
                          ? 'Invitation link copied'
                          : 'Copy invitation link and invite friends'
                      )
                    : t('Sign in to get your invitation link')}
                </Button>
                <div className='iv-share-info'>
                  {fullAuth ? (
                    <>
                      {t('My invitation code')} <b>{link.data?.code}</b>
                      <br />
                      {t('Friends can also enter it when registering.')}
                    </>
                  ) : (
                    t(
                      'Friends register with your link or code to establish an invitation relationship.'
                    )
                  )}
                </div>
                {fullAuth && link.data && (
                  <div className='iv-link-preview' title={link.data.url}>
                    {link.data.url}
                  </div>
                )}
              </>
            }
          />
        )}
        {fullAuth && (
          <>
            {privateQueries.some((query) => query.isPending) && (
              <LoadingState />
            )}
            {privateQueries.some((query) => query.isError) && (
              <ErrorState
                onRetry={() => {
                  for (const query of privateQueries) void query.refetch()
                }}
              />
            )}
            {summary.data && (
              <div
                className='iv-overview'
                aria-label={t('My invitation reward overview')}
              >
                <div>
                  <span>{t('Cumulative released rewards')}</span>
                  {summary.data.balances.length ? (
                    summary.data.balances.map((balance) => (
                      <div key={balance.point_type_id}>
                        <strong>{formatPoints(balance.released_total)}</strong>
                        <small>
                          {pointName({
                            id: balance.point_type_id,
                            code: balance.code,
                            name: balance.name,
                          })}
                        </small>
                      </div>
                    ))
                  ) : (
                    <strong>0</strong>
                  )}
                  <small>
                    {t(
                      'Includes previously spent rewards; see wallet for available points'
                    )}
                  </small>
                </div>
                <div>
                  <span>{t('Pending rewards')}</span>
                  {summary.data.balances.length ? (
                    summary.data.balances.map((balance) => (
                      <div key={balance.point_type_id}>
                        <strong>{formatPoints(balance.pending_total)}</strong>
                        <small>
                          {pointName({
                            id: balance.point_type_id,
                            code: balance.code,
                            name: balance.name,
                          })}
                        </small>
                      </div>
                    ))
                  ) : (
                    <strong>0</strong>
                  )}
                  <small>
                    {t('Available after each order’s release is confirmed')}
                  </small>
                </div>
              </div>
            )}
            <RewardHistory
              data={rewards.data}
              summary={summary.data}
              pending={rewards.isPending}
              error={rewards.isError}
              onRetry={() => void rewards.refetch()}
              page={rewardsPage}
              onPageChange={setRewardsPage}
            />
            <section className='iv-card iv-referrer'>
              <h2>{t('My inviter')}</h2>
              <p className='iv-card-sub'>
                {t(
                  'If you did not enter an invitation code during registration, you can add one here once. Binding is permanent and cannot be changed or removed.'
                )}
              </p>
              {binding.data?.bound ? (
                <div className='iv-ref-done'>
                  <div className='flex min-w-0 items-center gap-3'>
                    <Avatar>
                      <AvatarImage
                        src={binding.data.inviter_avatar_url}
                        alt={inviterName}
                        referrerPolicy='no-referrer'
                      />
                      <AvatarFallback style={getUserAvatarStyle(inviterName)}>
                        {getUserAvatarFallback(inviterName)}
                      </AvatarFallback>
                    </Avatar>
                    <strong className='min-w-0 break-all'>
                      <span>{t('Bound inviter')}: </span>
                      <span>{inviterName}</span>
                    </strong>
                  </div>
                  <span className='iv-ref-code'>
                    {binding.data.inviter_code}
                  </span>
                  <Button variant='outline' onClick={confirm}>
                    {t('View binding')}
                  </Button>
                </div>
              ) : (
                <div className='iv-ref-form'>
                  <Input
                    aria-label={t('Paste invitation link')}
                    maxLength={2048}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder={t('Paste invitation link or invitation code')}
                  />
                  <Button
                    className='iv-primary'
                    onClick={confirm}
                    disabled={
                      bind.isPending || !input.trim() || !binding.isSuccess
                    }
                  >
                    {t('Confirm binding')}
                  </Button>
                </div>
              )}
              {message && (
                <p className='iv-ref-message' role='status'>
                  {message}
                </p>
              )}
            </section>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirmDialog}
        onOpenChange={setConfirmDialog}
        title={t('Confirm permanent inviter binding')}
        desc={
          <>
            {t('Binding is permanent and cannot be changed or removed.')}
            <p className='break-all'>{input}</p>
          </>
        }
        confirmText={t('Bind permanently')}
        isLoading={bind.isPending}
        handleConfirm={() => {
          if (fullAuth) {
            bind.mutate({
              invitation: input.trim(),
              requestId: crypto.randomUUID(),
              viewer: user?.id ?? 0,
            })
          }
        }}
      />
      <Dialog
        open={boundDialog}
        onOpenChange={setBoundDialog}
        title={t('Bound inviter')}
      >
        <p>{t('You have already bound an inviter')}</p>
      </Dialog>
      <ActivityDialog open={activitiesOpen} onOpenChange={setActivitiesOpen} />
    </main>
  )
}

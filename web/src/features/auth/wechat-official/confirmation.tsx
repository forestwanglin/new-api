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
import { CheckCircle2, CircleX, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { IconWeChat } from '@/assets/brand-icons/icon-wechat'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { api } from '@/lib/api'
import {
  createServerError,
  getServerErrorMessage,
} from '@/lib/server-error-message'

export function OfficialWeChatConfirmation() {
  const { t } = useTranslation()
  const [data, setData] = useState<{
    intent: string
    site_name: string
    official_account_name?: string
    official_account_logo?: string
    expires_at: number
    csrf_token: string
    same_device?: boolean
  } | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState<'confirmed' | 'cancelled' | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void api
      .get('/api/oauth/wechat_official/confirmation', {
        signal: controller.signal,
        disableDuplicate: true,
        skipAuthRefresh: true,
      })
      .then((response) => {
        if (!response.data.success) throw createServerError(response.data)
        if (!controller.signal.aborted) setData(response.data.data)
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(getServerErrorMessage(failure))
      })
    return () => controller.abort()
  }, [])
  const confirm = async (confirmed: boolean) => {
    if (!data || busy) return
    setBusy(true)
    try {
      const response = await api.post(
        '/api/oauth/wechat_official/confirm',
        { csrf_token: data.csrf_token, confirmed },
        {
          skipAuthRefresh: true,
          skipBusinessError: true,
          skipErrorHandler: true,
        }
      )
      if (!response.data.success) throw createServerError(response.data)
      setDone(confirmed ? 'confirmed' : 'cancelled')
      if (confirmed && (response.data.data?.same_device || data.same_device)) {
        window.location.replace('/wechat-official/resume')
      }
    } catch (failure) {
      setError(getServerErrorMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  const accountName =
    data?.official_account_name || t('WeChat Official Account')
  const authorizationContext = {
    account: accountName,
    site: data?.site_name ?? '',
  }
  let consent = t(
    'Verify your identity for {{site}} via {{account}}?',
    authorizationContext
  )
  if (data?.intent === 'login') {
    consent = t('Sign in to {{site}} via {{account}}?', authorizationContext)
  }
  if (data?.intent === 'bind') {
    consent = t(
      'Bind your WeChat account to {{site}} via {{account}}?',
      authorizationContext
    )
  }
  let action = t('Security verification')
  if (data?.intent === 'login') action = t('Sign in')
  if (data?.intent === 'bind') action = t('Bind WeChat')
  return (
    <main className='bg-muted/30 flex min-h-svh items-center justify-center px-5 py-10 sm:px-6'>
      <Card className='w-full max-w-md rounded-3xl py-8 sm:py-10'>
        <CardContent className='px-6 sm:px-8'>
          <header className='flex flex-col items-center gap-4 text-center'>
            <Avatar className='size-16'>
              <AvatarImage
                src={data?.official_account_logo}
                alt={accountName}
                referrerPolicy='no-referrer'
              />
              <AvatarFallback className='bg-success/10 text-success'>
                <IconWeChat className='size-8' aria-hidden='true' />
              </AvatarFallback>
            </Avatar>
            <div className='w-full min-w-0 space-y-1.5'>
              <h1 className='text-xl font-semibold text-balance wrap-anywhere'>
                {accountName}
              </h1>
              <p className='text-muted-foreground text-sm'>
                {t('WeChat Official Account authorization')}
              </p>
            </div>
          </header>
          {error ? (
            <div role='alert' className='mt-6'>
              <ErrorState
                title={t('Authorization failed')}
                description={error}
                className='min-h-0 px-0 py-4 wrap-anywhere'
                action={
                  <p className='text-muted-foreground text-sm leading-relaxed'>
                    {t(
                      'Return to the original page and scan a new QR code to try again.'
                    )}
                  </p>
                }
              />
            </div>
          ) : null}
          {!error && done && (
            <div role='status' className='mt-6'>
              <EmptyState
                icon={done === 'confirmed' ? CheckCircle2 : CircleX}
                title={
                  done === 'confirmed'
                    ? t('Authorization successful')
                    : t('Cancelled')
                }
                description={
                  done === 'confirmed'
                    ? t(
                        'Authorization via {{account}} is complete. Return to {{site}} to continue.',
                        authorizationContext
                      )
                    : t(
                        'Authorization via {{account}} was cancelled. Return to {{site}} to start again.',
                        authorizationContext
                      )
                }
                className={
                  done === 'confirmed'
                    ? '[&_svg]:text-success min-h-0 px-0 py-4'
                    : 'min-h-0 px-0 py-4'
                }
              />
            </div>
          )}
          {!error && !done && !data && (
            <div role='status'>
              <LoadingState />
            </div>
          )}
          {!error && !done && data && (
            <div className='mt-6 space-y-6'>
              <p className='text-muted-foreground text-center text-sm leading-relaxed wrap-anywhere'>
                {consent}
              </p>
              <div className='bg-muted/60 flex items-center gap-3 rounded-xl px-4 py-4'>
                <ShieldCheck
                  className='text-muted-foreground size-5 shrink-0'
                  aria-hidden='true'
                />
                <p className='text-sm font-medium'>{action}</p>
              </div>
              <div className='flex flex-col gap-3'>
                <Button
                  className='min-h-12 w-full rounded-xl text-base'
                  disabled={busy || Date.now() >= data.expires_at * 1000}
                  onClick={() => void confirm(true)}
                >
                  {busy ? t('Processing...') : t('Confirm authorization')}
                </Button>
                <Button
                  className='min-h-12 w-full rounded-xl text-base'
                  variant='outline'
                  disabled={busy}
                  onClick={() => void confirm(false)}
                >
                  {t('Cancel')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

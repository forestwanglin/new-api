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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
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
  let action = t('Security verification')
  if (data?.intent === 'login') action = t('Sign in')
  if (data?.intent === 'bind') action = t('Bind WeChat')
  return (
    <main className='mx-auto max-w-md space-y-5 p-6'>
      <h1 className='text-xl font-semibold'>
        {t('WeChat Official Account authorization')}
      </h1>
      {error && <p role='alert'>{error}</p>}
      {done ? (
        <p role='status'>
          {done === 'confirmed'
            ? t('Authorization completed. Return to the original page.')
            : t('Cancelled')}
        </p>
      ) : (
        data && (
          <>
            <p>
              {t('Authorize {{site}} to continue?', { site: data.site_name })}
            </p>
            <p>{action}</p>
            <div className='flex gap-3'>
              <Button
                disabled={busy || Date.now() >= data.expires_at * 1000}
                onClick={() => void confirm(true)}
              >
                {t('Confirm authorization')}
              </Button>
              <Button
                variant='outline'
                disabled={busy}
                onClick={() => void confirm(false)}
              >
                {t('Cancel')}
              </Button>
            </div>
          </>
        )
      )}
    </main>
  )
}

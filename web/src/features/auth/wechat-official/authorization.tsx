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
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  officialBrowser,
  officialRequest,
  type OfficialFlow,
  type OfficialRequest,
  type OfficialStatus,
} from './api'
import { matchesOfficialRequest } from './resume-context'
import { saveOfficialUIDraft } from './ui-draft'

interface AuthorizationProps {
  request: OfficialRequest
  enabled?: boolean
  afterQr?: ReactNode
  onResult: (result: unknown, request: OfficialRequest) => void | Promise<void>
}
export function OfficialWeChatAuthorization(props: AuthorizationProps) {
  const { t } = useTranslation()
  const [revision, setRevision] = useState(0)
  const [flow, setFlow] = useState<OfficialFlow | null>(null)
  const [status, setStatus] = useState<OfficialStatus>('pending')
  const [error, setError] = useState('')
  const callback = useRef(props.onResult)
  callback.current = props.onResult
  const requestKey = JSON.stringify(props.request)
  const sid = useAuthStore(
    (state) => `${state.auth.user?.id}:${state.auth.session?.sid}`
  )
  const sameDevice = /MicroMessenger/i.test(navigator.userAgent)
  const navigating = useRef(false)
  useEffect(() => {
    navigating.current = false
    setFlow(null)
    setError('')
    setStatus('pending')
    if (props.enabled === false) return
    const controller = new AbortController()
    let token = ''
    let current: OfficialFlow | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let polling = false
    let finished = false
    let consumed = false
    const poll = async () => {
      if (!current || polling || finished || controller.signal.aborted) return
      if (Date.now() >= current.expires_at * 1000) {
        finished = true
        setStatus('expired')
        return
      }
      if (document.hidden) return
      polling = true
      try {
        const result = await officialRequest<{ status: OfficialStatus }>(
          'flows/status',
          { flow_token: current.flow_token },
          token,
          controller.signal
        )
        if (controller.signal.aborted) return
        setStatus(result.status)
        if (result.status === 'authorized') {
          finished = true
          const outcome = await officialRequest<unknown>(
            'flows/complete',
            { flow_token: current.flow_token },
            token,
            controller.signal
          )
          if (!controller.signal.aborted) {
            consumed = true
            await callback.current(outcome, JSON.parse(requestKey))
          }
        } else if (
          ['cancelled', 'denied', 'failed', 'expired'].includes(result.status)
        ) {
          finished = true
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          finished = true
          setError(getServerErrorMessage(failure))
        }
      } finally {
        polling = false
        if (!finished && !controller.signal.aborted) {
          timer = setTimeout(() => void poll(), 2000)
        }
      }
    }
    const visible = () => {
      if (!document.hidden) {
        clearTimeout(timer)
        void poll()
      }
    }
    document.addEventListener('visibilitychange', visible)
    void (async () => {
      try {
        token = await officialBrowser(controller.signal)
        if (revision === 0 && sameDevice && props.request.intent !== 'login') {
          try {
            const restored = await officialRequest<
              OfficialFlow & OfficialRequest & { status: OfficialStatus }
            >('flows/resume', {}, token, controller.signal)
            const matches = matchesOfficialRequest(
              restored,
              JSON.parse(requestKey)
            )
            if (matches && restored.status === 'authorized') {
              current = restored
              setFlow(restored)
              void poll()
              return
            }
          } catch {
            if (controller.signal.aborted) return
          }
        }
        current = await officialRequest<OfficialFlow>(
          'flows',
          {
            ...JSON.parse(requestKey),
            same_device: sameDevice,
            return_target: window.location.pathname + window.location.search,
          },
          token,
          controller.signal
        )
        if (controller.signal.aborted) {
          void officialRequest(
            'flows/cancel',
            { flow_token: current.flow_token },
            token
          ).catch(() => undefined)
          return
        }
        setFlow(current)
        void poll()
      } catch (failure) {
        if (!controller.signal.aborted) setError(getServerErrorMessage(failure))
      }
    })()
    return () => {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
      if (current && !consumed && !navigating.current) {
        void officialRequest(
          'flows/cancel',
          { flow_token: current.flow_token },
          token
        ).catch(() => undefined)
      }
    }
  }, [
    requestKey,
    props.enabled,
    revision,
    sid,
    sameDevice,
    props.request.intent,
  ])
  const terminal = ['cancelled', 'denied', 'failed', 'expired'].includes(status)
  const qrReady =
    props.enabled !== false && Boolean(flow?.qr_url) && !terminal && !error
  const preparing = props.enabled !== false && !qrReady && !terminal && !error
  return (
    <div className='space-y-3 py-3 text-center'>
      <div className='mx-auto w-fit max-w-full rounded-2xl border border-black/10 bg-white p-2'>
        {flow && qrReady ? (
          <QRCodeSVG
            value={flow.qr_url}
            size={224}
            marginSize={4}
            bgColor='#ffffff'
            fgColor='#000000'
            className='h-auto max-w-full'
            title={t('WeChat authorization QR code')}
          />
        ) : (
          <div
            aria-hidden='true'
            className='flex aspect-square w-56 max-w-full items-center justify-center'
          >
            {preparing && (
              <LoadingState inline size='lg' className='text-neutral-400' />
            )}
          </div>
        )}
      </div>
      {props.enabled === false && (
        <p role='status'>
          {t('Accept the terms before authorizing with WeChat.')}
        </p>
      )}
      {qrReady && <p role='status'>{t('Scan with WeChat to authorize.')}</p>}
      {preparing && (
        <p role='status' className='text-muted-foreground'>
          {t('Preparing WeChat authorization...')}
        </p>
      )}
      {flow && qrReady && (
        <>
          {status === 'awaiting_consent' && (
            <p role='status'>{t('Confirm authorization in WeChat.')}</p>
          )}
          {sameDevice && (
            <Button
              type='button'
              onClick={() => {
                navigating.current = true
                if (props.request.intent === 'bind') {
                  saveOfficialUIDraft('bind', true)
                }
                if (
                  props.request.intent === 'verify' &&
                  props.request.scope.startsWith('access_token.')
                ) {
                  saveOfficialUIDraft('token-action', true)
                }
                if (
                  props.request.intent === 'verify' &&
                  props.request.scope === 'access_token.revoke'
                ) {
                  saveOfficialUIDraft(
                    'token-revoke',
                    'legacy' in props.request.context
                      ? 'legacy'
                      : props.request.context.token_id
                  )
                }
                window.location.assign(flow.qr_url)
              }}
            >
              {t('Open WeChat authorization')}
            </Button>
          )}
        </>
      )}
      {terminal && (
        <p role='status'>
          {t('WeChat authorization ended. Please refresh the QR code.')}
        </p>
      )}
      {error && (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      )}
      {props.enabled !== false && (terminal || error) && (
        <Button
          type='button'
          variant='outline'
          onClick={() => setRevision((value) => value + 1)}
        >
          {t('Refresh QR code')}
        </Button>
      )}
      {props.afterQr}
    </div>
  )
}

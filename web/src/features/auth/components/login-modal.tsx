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
import { useMutation } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useStatus } from '@/hooks/use-status'
import { applyAuthBundle, isAuthBundle } from '@/lib/api'
import { markServerErrorHandled } from '@/lib/handle-server-error'
import { AuthOperationError } from '@/lib/secure-verification'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'

import { sanitizeAuthRedirect } from '../lib/auth-redirect'
import { getPhoneCaptcha, phoneAuthRequest } from '../phone-api'
import {
  isLoginChallenge,
  SecureVerificationDialog,
  useSecureVerification,
} from '../secure-verification'
import { LegalConsent } from './legal-consent'
import { PhoneAuthForm } from './phone-auth-form'

import '@/styles/login-modal.css'

export function LoginModal() {
  const isOpen = useLoginModalStore((state) => state.isOpen)
  if (!isOpen) return null
  return <LoginModalContent />
}

function LoginModalContent() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const navigate = useNavigate()
  const router = useRouter()
  const initialBindToken = useLoginModalStore((state) => state.bindToken)
  const [tab, setTab] = useState('wechat')
  const [bindToken, setBindToken] = useState(initialBindToken)
  const [wechatCode, setWeChatCode] = useState('')
  const [error, setError] = useState('')
  const [agreed, setAgreed] = useState(false)
  const initialSID = useRef(useAuthStore.getState().auth.session?.sid).current
  const active = useRef(true)
  const request = useRef<AbortController | null>(null)
  const verification = useSecureVerification()
  const { cancel } = verification
  const phoneEnabled = Boolean(status?.phone_login ?? status?.data?.phone_login)
  const wechatEnabled = Boolean(
    status?.wechat_login ?? status?.data?.wechat_login
  )
  const qr = status?.wechat_qrcode ?? status?.data?.wechat_qrcode
  const requiresConsent = Boolean(
    status?.user_agreement_enabled || status?.privacy_policy_enabled
  )
  const enabled = !requiresConsent || agreed

  useEffect(() => {
    if (initialBindToken) {
      setBindToken(initialBindToken)
      setTab('wechat')
    }
  }, [initialBindToken])
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      request.current?.abort()
      cancel()
    }
  }, [cancel])

  const onResult = async (result: unknown) => {
    if (
      !active.current ||
      useAuthStore.getState().auth.session?.sid !== initialSID
    ) {
      return
    }
    if (
      result &&
      typeof result === 'object' &&
      'require_phone_binding' in result &&
      result.require_phone_binding === true &&
      'bind_token' in result &&
      typeof result.bind_token === 'string'
    ) {
      setBindToken(result.bind_token)
      setTab('wechat')
      return
    }
    let bundle = result
    if (isLoginChallenge(bundle)) {
      bundle = await verification.requestLoginVerification(bundle)
    }
    if (
      !active.current ||
      !bundle ||
      useAuthStore.getState().auth.session?.sid !== initialSID
    ) {
      return
    }
    if (!isAuthBundle(bundle)) throw new AuthOperationError('Login failed')
    const redirectTo = sanitizeAuthRedirect(
      useLoginModalStore.getState().redirectTo,
      window.location.origin
    )
    applyAuthBundle(bundle)
    useLoginModalStore.getState().close()
    await router.invalidate()
    if (redirectTo) await navigate({ href: redirectTo, replace: true })
  }

  const wechat = useMutation({
    mutationFn: async () => {
      setError('')
      request.current?.abort()
      const controller = new AbortController()
      request.current = controller
      const captcha = await getPhoneCaptcha(controller.signal)
      const result = await phoneAuthRequest<unknown>(
        '/api/oauth/wechat',
        { code: wechatCode.trim() },
        captcha.browser_token,
        controller.signal
      )
      if (!controller.signal.aborted) await onResult(result)
    },
    onError: (failure) => {
      markServerErrorHandled(failure)
      if (active.current && !request.current?.signal.aborted) {
        setError(getServerErrorMessage(failure))
      }
    },
    meta: { errorToast: false },
  })
  const close = () => {
    request.current?.abort()
    cancel()
    useLoginModalStore.getState().close()
  }

  return (
    <>
      <Dialog
        open={!verification.isActive}
        onOpenChange={(open) => {
          if (!open) close()
        }}
        title={t('Register / Sign in')}
        description={t(
          'Choose a way to continue. New accounts are registered automatically after verification.'
        )}
        contentClassName='login-modal'
        overlayClassName='login-modal-overlay'
        headerClassName='auth-heading'
        titleClassName='auth-title'
        descriptionClassName='auth-context'
        bodyClassName='auth-body'
        showCloseButton={false}
      >
        <Button
          type='button'
          variant='ghost'
          className='auth-close'
          onClick={close}
          aria-label={t('Close sign in dialog')}
        >
          ×
        </Button>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(String(value))
            setError('')
          }}
          className='auth-tabs-root'
        >
          <TabsList className='auth-tabs' aria-label={t('Sign in method')}>
            <TabsTrigger value='wechat'>{t('WeChat QR code')}</TabsTrigger>
            <TabsTrigger value='phone'>
              {t('Phone verification code')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value='wechat'>
            {bindToken ? (
              <PhoneAuthForm
                bindToken={bindToken}
                enabled={phoneEnabled && enabled}
                onResult={onResult}
              />
            ) : (
              <form
                className='auth-panel'
                onSubmit={(event) => {
                  event.preventDefault()
                  if (enabled && wechatEnabled && wechatCode.trim()) {
                    wechat.mutate()
                  }
                }}
              >
                {qr ? (
                  <div className='auth-qr'>
                    <img src={qr} alt={t('WeChat login QR code')} />
                  </div>
                ) : (
                  <p className='auth-helper'>
                    {t('WeChat login QR code is not configured')}
                  </p>
                )}
                <p className='auth-qr-status'>
                  {t(
                    'Scan with WeChat and enter the official account verification code'
                  )}
                </p>
                <Label htmlFor='modal-wechat-code'>
                  {t('WeChat verification code')}
                </Label>
                <Input
                  id='modal-wechat-code'
                  autoComplete='one-time-code'
                  value={wechatCode}
                  maxLength={64}
                  onChange={(event) => setWeChatCode(event.target.value)}
                  placeholder={t('Enter verification code')}
                />
                {!wechatEnabled && (
                  <p className='auth-helper'>
                    {t('WeChat sign in is not enabled')}
                  </p>
                )}
                {error && (
                  <div className='auth-error' role='alert'>
                    {error}
                  </div>
                )}
                <Button
                  type='submit'
                  className='auth-submit'
                  disabled={
                    !enabled ||
                    !wechatEnabled ||
                    !wechatCode.trim() ||
                    wechat.isPending
                  }
                >
                  {t('Confirm')}
                </Button>
              </form>
            )}
          </TabsContent>
          <TabsContent value='phone'>
            <PhoneAuthForm
              enabled={phoneEnabled && enabled}
              onResult={onResult}
            />
          </TabsContent>
        </Tabs>
        {requiresConsent && (
          <LegalConsent
            status={status}
            checked={agreed}
            onCheckedChange={setAgreed}
            className='mt-4'
          />
        )}
      </Dialog>
      <SecureVerificationDialog {...verification.dialogProps} />
    </>
  )
}

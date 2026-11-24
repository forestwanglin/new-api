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
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { markServerErrorHandled } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { getSMSDeliveryRecovery } from '@/lib/sms-delivery'

import { getAffiliateCode } from '../lib/storage'
import { getPhoneCaptcha, phoneAuthRequest } from '../phone-api'

const phoneSchema = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/),
  answer: z.string(),
  code: z.string().regex(/^\d{6}$/),
})
type PhoneFields = z.infer<typeof phoneSchema>

interface PhoneAuthFormProps {
  affiliateCode?: string
  bindToken?: string
  enabled: boolean
  available?: boolean
  beforeSubmit?: ReactNode
  onResult: (result: unknown, affiliateCode?: string) => Promise<void> | void
}

export function PhoneAuthForm(props: PhoneAuthFormProps) {
  const { t } = useTranslation()
  const id = useId()
  const [sendToken, setSendToken] = useState('')
  const [sendExpiresAt, setSendExpiresAt] = useState(0)
  const [smsToken, setSMSToken] = useState('')
  const [sentChallenge, setSentChallenge] = useState('')
  const sendAffiliateCode = useRef('')
  const smsAffiliateCode = useRef('')
  const [retryAt, setRetryAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const active = useRef(true)
  const operation = useRef<AbortController | null>(null)
  const imageOperation = useRef<AbortController | null>(null)
  const attemptedChallenges = useRef(new Set<string>())
  const replacingChallenge = useRef<string | undefined>(undefined)
  const [imageVerifying, setImageVerifying] = useState(false)
  const form = useForm<PhoneFields>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { phone: '', answer: '', code: '' },
  })
  const phone = form.watch('phone')
  const answer = form.watch('answer')
  const code = form.watch('code')
  const captcha = useQuery({
    queryKey: ['phone-login-captcha', id],
    queryFn: ({ signal }) => getPhoneCaptcha(signal),
    retry: false,
    refetchOnWindowFocus: false,
    gcTime: 0,
    meta: { errorToast: false },
  })

  const { refetch: refetchCaptcha } = captcha

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      operation.current?.abort()
      imageOperation.current?.abort()
    }
  }, [])
  useEffect(() => {
    if (!retryAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [retryAt])

  useEffect(() => {
    const challenge = captcha.data
    setSendToken('')
    setSendExpiresAt(0)
    operation.current?.abort()
    setSMSToken('')
    setImageVerifying(false)
    if (
      !props.enabled ||
      !challenge ||
      !/^1[3-9]\d{9}$/.test(phone) ||
      !/^\d{5}$/.test(answer)
    ) {
      return
    }
    if (attemptedChallenges.current.has(challenge.challenge_token)) {
      if (replacingChallenge.current !== challenge.challenge_token) {
        replacingChallenge.current = challenge.challenge_token
        form.setValue('answer', '')
        void refetchCaptcha()
      }
      return
    }
    const controller = new AbortController()
    imageOperation.current = controller
    const timer = window.setTimeout(async () => {
      if (controller.signal.aborted || !active.current) return
      // A challenge allows one server attempt, including aborted/ambiguous requests.
      attemptedChallenges.current.add(challenge.challenge_token)
      setImageVerifying(true)
      setError('')
      try {
        const affiliateCode = props.affiliateCode ?? getAffiliateCode()
        const result = await phoneAuthRequest<{ send_token: string }>(
          '/api/phone/captcha/verify',
          {
            phone,
            answer,
            challenge_token: challenge.challenge_token,
            bind_token: props.bindToken,
            aff: affiliateCode || undefined,
          },
          challenge.browser_token,
          controller.signal
        )
        if (!controller.signal.aborted && active.current) {
          sendAffiliateCode.current = affiliateCode
          setSendToken(result.send_token)
        }
      } catch (failure) {
        markServerErrorHandled(failure)
        if (!controller.signal.aborted && active.current) {
          setError(getServerErrorMessage(failure))
          form.setValue('answer', '')
          void refetchCaptcha()
        }
      } finally {
        if (active.current && imageOperation.current === controller) {
          setImageVerifying(false)
        }
      }
    }, 350)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [
    phone,
    answer,
    props.enabled,
    props.bindToken,
    props.affiliateCode,
    captcha.data,
    form,
    refetchCaptcha,
  ])

  const action = useMutation({
    mutationFn: async (kind: 'send' | 'login') => {
      if (!props.enabled || !captcha.data) return
      operation.current?.abort()
      const controller = new AbortController()
      operation.current = controller
      const request = <T,>(path: string, body: object) =>
        phoneAuthRequest<T>(
          path,
          body,
          captcha.data.browser_token,
          controller.signal
        )
      setError('')
      try {
        if (kind === 'send') {
          // Each attempt consumes its permit; explicit rejection may issue a new one.
          if (
            !sendToken ||
            (sendExpiresAt > 0 && Date.now() >= sendExpiresAt)
          ) {
            return
          }
          const permit = sendToken
          const affiliateCode = sendAffiliateCode.current
          setSendToken('')
          setSendExpiresAt(0)
          setSentChallenge(captcha.data.challenge_token)
          setSMSToken('')
          const result = await request<{
            sms_token: string
            retry_after: number
          }>('/api/phone/sms/send', { send_token: permit })
          if (!controller.signal.aborted && active.current) {
            smsAffiliateCode.current = affiliateCode
            setSMSToken(result.sms_token)
            setRetryAt(Date.now() + result.retry_after * 1000)
            setNow(Date.now())
          }
        } else {
          const result = await request<unknown>('/api/phone/login', {
            sms_token: smsToken,
            code,
          })
          if (!controller.signal.aborted && active.current) {
            await props.onResult(result, smsAffiliateCode.current)
          }
        }
      } catch (failure) {
        markServerErrorHandled(failure)
        if (!controller.signal.aborted && active.current) {
          setError(getServerErrorMessage(failure))
          if (kind === 'send') {
            const recovery = getSMSDeliveryRecovery(failure)
            setSendToken(recovery?.retryToken ?? '')
            setSendExpiresAt(recovery?.expiresAt ?? 0)
            if (recovery) {
              setRetryAt(Date.now() + recovery.retryAfter * 1000)
              setNow(Date.now())
            }
          }
        }
        throw failure
      }
    },
    meta: { errorToast: false },
  })

  const imageUsed = sentChallenge === captcha.data?.challenge_token
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000))
  const invalidateImage = () => {
    imageOperation.current?.abort()
    setImageVerifying(false)
    setSendToken('')
    setSendExpiresAt(0)
  }
  const replaceUsedImage = () => {
    const token = captcha.data?.challenge_token
    if (
      token &&
      attemptedChallenges.current.has(token) &&
      replacingChallenge.current !== token
    ) {
      replacingChallenge.current = token
      form.setValue('answer', '')
      void refetchCaptcha()
    }
  }
  const resetProof = () => {
    invalidateImage()
    operation.current?.abort()
    setSendToken('')
    setSMSToken('')
    form.setValue('code', '')
    setError('')
  }
  const refreshImage = () => {
    resetProof()
    form.setValue('answer', '')
    void refetchCaptcha()
  }

  return (
    <form
      className='auth-panel'
      onSubmit={form.handleSubmit(() => action.mutate('login'))}
      noValidate
    >
      {props.bindToken && (
        <p className='auth-helper'>
          {t('Bind a phone number to finish WeChat sign in')}
        </p>
      )}
      <Label htmlFor={`${id}-phone`}>
        {t('Phone number (mainland China +86)')}
      </Label>
      <Input
        id={`${id}-phone`}
        type='tel'
        inputMode='tel'
        autoComplete='tel-national'
        maxLength={11}
        placeholder={t('Enter your 11-digit phone number')}
        {...form.register('phone', {
          onChange: () => {
            resetProof()
            replaceUsedImage()
          },
        })}
        aria-invalid={Boolean(form.formState.errors.phone)}
      />
      <Label htmlFor={`${id}-image`}>{t('Image verification code')}</Label>
      <div className='auth-code-row'>
        <Input
          id={`${id}-image`}
          inputMode='numeric'
          autoComplete='off'
          maxLength={5}
          readOnly={imageUsed}
          placeholder={t('Enter image code')}
          {...form.register('answer', {
            onChange: () => {
              invalidateImage()
              replaceUsedImage()
            },
          })}
        />
        <Button
          type='button'
          variant='outline'
          className='auth-captcha'
          onClick={refreshImage}
          disabled={captcha.isFetching || action.isPending}
          aria-label={t('Refresh image code')}
        >
          {captcha.data && (
            <img
              src={captcha.data.image}
              alt={t('Image verification code')}
              width={110}
              height={36}
            />
          )}
          {!captcha.data && t('Refresh')}
        </Button>
      </div>
      <Label htmlFor={`${id}-sms`}>{t('SMS verification code')}</Label>
      <div className='auth-code-row'>
        <Input
          id={`${id}-sms`}
          inputMode='numeric'
          autoComplete='one-time-code'
          maxLength={6}
          placeholder={t('6-digit code')}
          {...form.register('code')}
          aria-invalid={Boolean(form.formState.errors.code)}
        />
        <Button
          type='button'
          variant='outline'
          onClick={() => action.mutate('send')}
          disabled={
            !props.enabled ||
            !sendToken ||
            (sendExpiresAt > 0 && now >= sendExpiresAt) ||
            imageVerifying ||
            action.isPending ||
            remaining > 0
          }
        >
          {remaining
            ? t('Resend in {{seconds}}s', { seconds: remaining })
            : t('Get verification code')}
        </Button>
      </div>
      <p className='auth-helper' role='status'>
        {imageUsed && !sendToken && t('Refresh image code')}
        {(!imageUsed || Boolean(sendToken)) &&
          (sendToken
            ? t('Image verified')
            : t('Verify the image code before requesting an SMS code'))}
      </p>
      {!(props.available ?? props.enabled) && (
        <p className='auth-helper'>
          {t(
            'Phone login is not configured. Please contact your administrator.'
          )}
        </p>
      )}
      {(error || captcha.error) && (
        <div className='auth-error' role='alert'>
          {error || getServerErrorMessage(captcha.error)}
        </div>
      )}
      {props.beforeSubmit}
      <Button
        type='submit'
        className='auth-submit'
        disabled={
          !props.enabled ||
          action.isPending ||
          !smsToken ||
          !/^\d{6}$/.test(code)
        }
      >
        {props.bindToken
          ? t('Bind phone and sign in')
          : t('Register / Sign in')}
      </Button>
    </form>
  )
}

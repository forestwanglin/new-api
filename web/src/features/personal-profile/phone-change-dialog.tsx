import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAccountSecurity } from '@/features/security/hooks/use-account-security'
import { SupportDialog } from '@/features/subscriptions-custom/support-dialog'
import { useCountdown } from '@/hooks/use-countdown'
import { getServerErrorMessage } from '@/lib/server-error-message'

import {
  changePhone,
  getPhoneChangeCaptcha,
  sendPhoneCode,
  verifyPhoneCode,
  type PhoneChangeStatus,
  type PhoneBindingAuthorization,
} from './api'

type Props = {
  open: boolean
  status: PhoneChangeStatus
  bindingAuthorization?: PhoneBindingAuthorization
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function PhoneChangeDialog(props: Props) {
  const { t } = useTranslation()
  const security = useAccountSecurity()
  const [step, setStep] = useState<'old' | 'new'>(
    props.status.bound ? 'old' : 'new'
  )
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [captchaAnswer, setCaptchaAnswer] = useState('')
  const [smsToken, setSMSToken] = useState('')
  const [usedChallenge, setUsedChallenge] = useState('')
  const [verificationToken, setVerificationToken] = useState('')
  const verificationExpiresAt = useRef(0)
  const [expired, setExpired] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const resend = useCountdown({ initialSeconds: 90 })
  const codeRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const cancel = security.cancel
  const captcha = useQuery({
    queryKey: ['phone-change-captcha', security.sessionKey, step, props.open],
    queryFn: ({ signal }) => getPhoneChangeCaptcha(signal),
    enabled: props.open,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  const refreshCaptcha = () => {
    setCaptchaAnswer('')
    void captcha.refetch()
  }

  const imageUsed = usedChallenge === captcha.data?.challenge_token

  useEffect(() => {
    setCaptchaAnswer('')
    setUsedChallenge('')
  }, [captcha.data?.challenge_token, step, props.open, security.sessionKey])

  useEffect(() => {
    setStep(props.status.bound ? 'old' : 'new')
    setPhone('')
    setCode('')
    setSMSToken('')
    setVerificationToken(props.bindingAuthorization?.token ?? '')
    verificationExpiresAt.current =
      (props.bindingAuthorization?.expires_at ?? 0) * 1000
    setExpired(false)
    return cancel
  }, [
    props.open,
    props.status.bound,
    props.bindingAuthorization,
    security.sessionKey,
    cancel,
  ])

  useEffect(() => {
    if (!props.open) return
    if (step === 'old') codeRef.current?.focus()
    else phoneRef.current?.focus()
  }, [props.open, step])

  const close = (open: boolean) => {
    if (!open) security.cancel()
    props.onOpenChange(open)
  }
  const resetExpiredVerification = () => {
    if (step !== 'new' || Date.now() < verificationExpiresAt.current) {
      return false
    }
    security.cancel()
    if (!props.status.bound) {
      close(false)
      toast.error(t('Security verification has expired. Please verify again.'))
      return true
    }
    setStep('old')
    setVerificationToken('')
    verificationExpiresAt.current = 0
    setSMSToken('')
    setCode('')
    setExpired(true)
    resend.reset()
    return true
  }
  const send = async () => {
    if (
      resetExpiredVerification() ||
      !captcha.data ||
      captcha.isFetching ||
      captcha.isError ||
      imageUsed ||
      !/^\d{5}$/.test(captchaAnswer)
    ) {
      return
    }
    setExpired(false)
    const result = await security.run(async (signal) => {
      // Delivery attempts consume the image even when the outcome is unknown.
      setUsedChallenge(captcha.data.challenge_token)
      return {
        ...(await sendPhoneCode(
          step,
          phone,
          verificationToken,
          captcha.data.challenge_token,
          captchaAnswer,
          signal
        )),
        notification_warning: false,
      }
    })
    if (!result) return
    setSMSToken(result.token)
    setCode('')
    resend.start(result.retry_after)
    codeRef.current?.focus()
  }
  const submit = async () => {
    if (resetExpiredVerification()) return
    const verificationStartedAt = Date.now()
    const result = await security.run(async (signal) => {
      const verified = await verifyPhoneCode(
        step,
        smsToken,
        phone,
        code,
        signal
      )
      if (step === 'new') await changePhone(verified.token, signal)
      return { ...verified, notification_warning: false }
    })
    if (!result) return
    if (step === 'old') {
      setVerificationToken(result.token)
      verificationExpiresAt.current = verificationStartedAt + 10 * 60 * 1000
      setStep('new')
      setSMSToken('')
      setCode('')
      resend.reset()
      queueMicrotask(() => phoneRef.current?.focus())
    } else {
      close(false)
      props.onSuccess()
      toast.success(
        t('Phone number updated; other devices have been signed out')
      )
    }
  }
  const title = t(
    props.status.bound ? 'Change phone number' : 'Bind phone number'
  )
  let submitLabel = t('Next')
  if (step === 'new') {
    submitLabel = t(props.status.bound ? 'Confirm change' : 'Confirm binding')
  }
  const errorMessage = expired
    ? 'Security verification has expired. Please verify again.'
    : security.error?.message
  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={close}
        title={title}
        description={t(
          props.status.bound
            ? 'Verify your current phone, then your new phone. Other devices will be signed out; this device stays signed in.'
            : 'Verify your phone number to enable quick sign-in.'
        )}
        contentClassName='personal-profile-phone-dialog'
        overlayClassName='personal-profile-phone-overlay'
        headerClassName='pp-dialog-header'
        bodyClassName='pp-dialog-body'
        footerClassName='pp-dialog-footer'
        showCloseButton={false}
        footer={
          <>
            <Button
              className='pp-button pp-outline'
              variant='outline'
              onClick={() => close(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              className='pp-button pp-primary'
              disabled={security.pending || !smsToken || !/^\d{6}$/.test(code)}
              onClick={() => void submit()}
            >
              {submitLabel}
            </Button>
          </>
        }
      >
        <div className='pp-field'>
          <Label className='pp-label' htmlFor='pp-change-phone'>
            {t(step === 'old' ? 'Current phone number' : 'New phone number')}
          </Label>
          <Input
            className='pp-input'
            ref={phoneRef}
            id='pp-change-phone'
            type='text'
            inputMode='tel'
            autoComplete='tel-national'
            maxLength={11}
            disabled={security.pending}
            readOnly={step === 'old'}
            value={step === 'old' ? props.status.phone_masked : phone}
            placeholder={t('11-digit mainland China phone number')}
            onChange={(event) => {
              setPhone(event.target.value)
              setSMSToken('')
              setCode('')
            }}
          />
        </div>
        <div className='pp-field'>
          <Label className='pp-label' htmlFor='pp-change-image'>
            {t('Image verification code')}
          </Label>
          <div className='pp-code-row'>
            <Input
              className='pp-input'
              id='pp-change-image'
              inputMode='numeric'
              autoComplete='off'
              maxLength={5}
              placeholder={t('Enter image code')}
              value={captchaAnswer}
              readOnly={imageUsed}
              disabled={security.pending || captcha.isFetching}
              onChange={(event) =>
                setCaptchaAnswer(
                  event.target.value.replaceAll(/\D/g, '').slice(0, 5)
                )
              }
            />
            <Button
              type='button'
              variant='outline'
              className='pp-button pp-outline pp-captcha'
              aria-label={t('Refresh image code')}
              disabled={security.pending || captcha.isFetching}
              onClick={refreshCaptcha}
            >
              {captcha.data ? (
                <img
                  src={captcha.data.image}
                  alt={t('Image verification code')}
                  width={110}
                  height={36}
                />
              ) : (
                t('Refresh')
              )}
            </Button>
          </div>
          {imageUsed && <p className='pp-hint'>{t('Refresh image code')}</p>}
          {captcha.error && (
            <p className='pp-error' role='alert'>
              {getServerErrorMessage(captcha.error)}
            </p>
          )}
        </div>
        <div className='pp-field'>
          <Label className='pp-label' htmlFor='pp-change-code'>
            {t('Verification code')}
          </Label>
          <div>
            <div className='pp-code-row'>
              <Input
                className='pp-input'
                ref={codeRef}
                id='pp-change-code'
                type='text'
                inputMode='numeric'
                autoComplete='one-time-code'
                maxLength={6}
                placeholder={t('6-digit verification code')}
                value={code}
                disabled={security.pending}
                onChange={(event) =>
                  setCode(event.target.value.replaceAll(/\D/g, '').slice(0, 6))
                }
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    smsToken &&
                    /^\d{6}$/.test(code) &&
                    !security.pending
                  ) {
                    void submit()
                  }
                }}
              />
              <Button
                className='pp-button pp-outline'
                variant='outline'
                disabled={
                  security.pending ||
                  captcha.isFetching ||
                  captcha.isError ||
                  imageUsed ||
                  !captcha.data ||
                  !/^\d{5}$/.test(captchaAnswer) ||
                  resend.isActive ||
                  (step === 'new' && !/^1[3-9]\d{9}$/.test(phone))
                }
                onClick={() => void send()}
              >
                {resend.isActive
                  ? t('Resend in {{seconds}}s', { seconds: resend.secondsLeft })
                  : t('Get code')}
              </Button>
            </div>
            <p className='pp-hint'>
              {t('Verification codes expire in 5 minutes.')}
            </p>
          </div>
        </div>
        {step === 'old' && (
          <div className='pp-hint'>
            {t('Cannot receive a code on your current phone?')}
            <Button
              variant='link'
              className='pp-support'
              onClick={() => {
                close(false)
                setSupportOpen(true)
              }}
            >
              {t('Contact support')}
            </Button>
          </div>
        )}
        {errorMessage && (
          <p className='pp-error' role='alert'>
            {t(errorMessage)}
          </p>
        )}
      </Dialog>
      <SupportDialog open={supportOpen} onOpenChange={setSupportOpen} />
    </>
  )
}

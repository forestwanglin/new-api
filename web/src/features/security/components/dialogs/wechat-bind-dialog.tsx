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
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { SecureVerificationDialog } from '@/features/auth/secure-verification'
import { WeChatMethodChoice } from '@/features/auth/wechat-official/method-choice'
import {
  bindWeChat,
  officialWeChatBindingRequest,
  getOfficialWeChatBindingVerification,
  getWeChatBindingVerification,
  sendWeChatBindingSMS,
  verifyWeChatBindingSMS,
} from '@/features/profile/api'
import type {
  AccountSecurityResult,
  WeChatBindingVerification,
} from '@/features/profile/types'
import { useCountdown } from '@/hooks/use-countdown'
import { useStatus } from '@/hooks/use-status'
import { handleServerError } from '@/lib/handle-server-error'

import { useAccountSecurity } from '../../hooks/use-account-security'

const wechatBindingSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Enter the verification code')
    .max(128, 'Invalid verification code'),
})

interface WeChatBindDialogProps {
  open: boolean
  qrCodeUrl: string
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function WeChatBindDialog(props: WeChatBindDialogProps) {
  const { t } = useTranslation()
  const security = useAccountSecurity()
  const { status } = useStatus()
  const officialEnabled = Boolean(
    status?.wechat_official_login ?? status?.data?.wechat_official_login
  )
  const codeEnabled = Boolean(
    status?.wechat_login ?? status?.data?.wechat_login
  )
  const [method, setMethod] = useState<'official' | 'code'>('official')
  const official = officialEnabled && (!codeEnabled || method === 'official')
  const [assertion, setAssertion] = useState('')
  const [verification, setVerification] =
    useState<WeChatBindingVerification | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [smsToken, setSMSToken] = useState('')
  const [smsCode, setSMSCode] = useState('')
  const resend = useCountdown({ initialSeconds: 90 })
  const resetResend = resend.reset
  const form = useForm<z.infer<typeof wechatBindingSchema>>({
    resolver: zodResolver(wechatBindingSchema),
    defaultValues: { code: '' },
  })
  const reset = form.reset
  const cancel = security.cancel
  useEffect(() => {
    setAssertion('')
    reset({ code: '' })
    setVerification(null)
    setLoadFailed(false)
    setSMSToken('')
    setSMSCode('')
    resetResend()
    if (!props.open) return
    const controller = new AbortController()
    void (
      official
        ? getOfficialWeChatBindingVerification
        : getWeChatBindingVerification
    )(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setVerification(result)
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setLoadFailed(true)
          handleServerError(error)
        }
      })
    return () => controller.abort()
  }, [props.open, security.sessionKey, resetResend, official, reset])
  useEffect(() => {
    reset({ code: '' })
  }, [reset, security.sessionKey])
  useEffect(() => {
    if (!props.open) {
      cancel()
      reset({ code: '' })
    }
  }, [props.open, cancel, reset])

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      security.cancel()
      form.reset({ code: '' })
    }
    props.onOpenChange(open)
  }
  const sendSMS = async () => {
    if (!(await form.trigger('code'))) return
    const result = await security.run(async (signal) => {
      const sent = official
        ? await officialWeChatBindingRequest<{
            sms_token: string
            retry_after: number
          }>('/sms/send', { assertion_token: assertion }, signal)
        : await sendWeChatBindingSMS(form.getValues('code').trim(), signal)
      return { ...sent, notification_warning: false }
    })
    if (result) {
      setSMSToken(result.sms_token)
      setSMSCode('')
      resend.start(result.retry_after)
    }
  }
  const submit = async (values: z.infer<typeof wechatBindingSchema>) => {
    if (
      !verification ||
      (verification.sms_required && (!smsToken || !/^\d{6}$/.test(smsCode)))
    ) {
      return
    }
    const result = await security.run(async (signal) => {
      const proof = verification.sms_required
        ? (official
            ? await officialWeChatBindingRequest<{ proof_token: string }>(
                '/sms/verify',
                {
                  assertion_token: assertion,
                  sms_token: smsToken,
                  sms_code: smsCode,
                },
                signal
              )
            : await verifyWeChatBindingSMS(
                values.code,
                smsToken,
                smsCode,
                signal
              )
          ).proof_token
        : await security.verify(
            {
              scope: 'account.binding.bind',
              context: {
                provider: official ? 'wechat_official' : 'wechat',
                code: official ? assertion : values.code,
              },
            },
            signal
          )
      return official
        ? officialWeChatBindingRequest<AccountSecurityResult>(
            '',
            { assertion_token: assertion },
            signal,
            proof
          )
        : bindWeChat(values.code, proof, signal)
    })
    if (!result) return
    toast.success(t('Binding successful!'))
    handleOpenChange(false)
    props.onSuccess()
  }

  return (
    <>
      <Dialog
        open={props.open && !security.showVerification}
        onOpenChange={handleOpenChange}
        title={t('Bind WeChat')}
        contentClassName='sm:max-w-md'
        footer={
          <>
            <Button
              type='button'
              variant='outline'
              onClick={() => handleOpenChange(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              type='submit'
              form='wechat-bind-form'
              disabled={
                security.pending ||
                !verification ||
                (official && !assertion) ||
                (verification.sms_required &&
                  (!smsToken || !/^\d{6}$/.test(smsCode)))
              }
            >
              {security.pending && <Spinner data-icon='inline-start' />}
              {t('Bind')}
            </Button>
          </>
        }
      >
        <Form {...form}>
          <form
            id='wechat-bind-form'
            onSubmit={form.handleSubmit(submit)}
            className='space-y-4'
          >
            {!verification && (
              <p role='status' className='text-muted-foreground text-sm'>
                {t(
                  loadFailed
                    ? 'Unable to load verification methods. Close this dialog and try again.'
                    : 'Loading verification methods...'
                )}
              </p>
            )}
            {props.open && !assertion && (
              <WeChatMethodChoice
                methods={[
                  ...(officialEnabled ? ['official' as const] : []),
                  ...(codeEnabled ? ['code' as const] : []),
                ]}
                request={{ intent: 'bind' }}
                onMethodChange={setMethod}
                onResult={(result) => {
                  if (
                    result &&
                    typeof result === 'object' &&
                    'assertion_token' in result &&
                    typeof result.assertion_token === 'string'
                  ) {
                    setAssertion(result.assertion_token)
                    form.setValue('code', result.assertion_token)
                  }
                }}
              >
                {props.qrCodeUrl ? (
                  <div className='flex justify-center'>
                    <img
                      src={props.qrCodeUrl}
                      alt={t('WeChat login QR code')}
                      className='size-48 rounded-lg border object-contain'
                    />
                  </div>
                ) : (
                  <p className='text-muted-foreground text-sm'>
                    {t('QR code is not configured. Please contact support.')}
                  </p>
                )}
                <FormField
                  control={form.control}
                  name='code'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('WeChat verification code')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          onChange={(event) => {
                            field.onChange(event)
                            setSMSToken('')
                            setSMSCode('')
                          }}
                          placeholder={t('Enter the verification code')}
                          autoComplete='one-time-code'
                          disabled={security.pending}
                          autoFocus
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </WeChatMethodChoice>
            )}
            {assertion && (
              <p role='status'>
                {t(
                  'WeChat authorization completed. Confirm binding to continue.'
                )}
              </p>
            )}
            {verification?.sms_required && (
              <div className='space-y-2'>
                <p className='text-muted-foreground text-sm'>
                  {t('Verify your phone {{phone}} before binding WeChat.', {
                    phone: verification.phone_masked,
                  })}
                </p>
                <Label htmlFor='wechat-bind-sms-code'>
                  {t('SMS verification code')}
                </Label>
                <div className='flex items-center gap-2'>
                  <Input
                    id='wechat-bind-sms-code'
                    value={smsCode}
                    onChange={(event) =>
                      setSMSCode(
                        event.target.value.replaceAll(/\D/g, '').slice(0, 6)
                      )
                    }
                    inputMode='numeric'
                    autoComplete='one-time-code'
                    maxLength={6}
                    disabled={security.pending || !smsToken}
                  />
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => void sendSMS()}
                    disabled={
                      security.pending ||
                      resend.isActive ||
                      !form.watch('code').trim()
                    }
                  >
                    {resend.isActive
                      ? t('Resend in {{seconds}}s', {
                          seconds: resend.secondsLeft,
                        })
                      : t('Send code')}
                  </Button>
                </div>
              </div>
            )}
          </form>
        </Form>
      </Dialog>
      {security.showVerification && (
        <SecureVerificationDialog {...security.verificationDialogProps} />
      )}
    </>
  )
}

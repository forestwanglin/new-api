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
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { WeChatVerificationHint } from '../../components/wechat-verification-hint'
import type { PasskeyDomains } from '../../passkey/assertion'
import { PasskeyDomainSelector } from '../../passkey/components/passkey-domain-selector'
import type {
  SecureVerificationState,
  VerificationInput,
  VerificationMethod,
} from '../types'

interface SecureVerificationDialogProps {
  state: SecureVerificationState
  passkeyDomains?: PasskeyDomains | null
  onSendSMS?: () => void | Promise<void>
  smsSending?: boolean
  smsRetryAfter?: number
  onVerify: (input?: VerificationInput) => void | Promise<void>
  onCancel: () => void
  onRetry: () => void
  onInputChange: (input: VerificationInput) => void
}

const methodLabels: Record<VerificationMethod, string> = {
  '2fa': 'Authenticator code',
  passkey: 'Passkey',
  password: 'Password',
  oauth: 'Linked account',
  session: 'Login session',
  wechat: 'WeChat',
  sms: 'SMS verification code',
}

export function SecureVerificationDialog(props: SecureVerificationDialogProps) {
  const { t } = useTranslation()
  const inputId = useId()
  const state = props.state
  if (state.phase === 'idle') return null
  const ready =
    state.phase === 'ready' || state.phase === 'verifying' ? state : null
  const input = ready?.input
  const verifying = state.phase === 'verifying'
  const login = state.request.scope === 'auth.login'
  const acceptsBackupCode =
    state.request.scope !== '2fa.backup_codes.regenerate'
  let canVerify = state.phase === 'ready' && Boolean(input) && !props.smsSending
  if (input?.method === 'password') {
    canVerify = canVerify && input.password.length > 0
  }
  if (input?.method === '2fa') {
    canVerify = canVerify && input.code.trim().length >= 6
  }
  if (input?.method === 'wechat') {
    canVerify = canVerify && /^\d{4,10}$/.test(input.code.trim())
  }
  if (input?.method === 'sms') {
    canVerify =
      canVerify && Boolean(input.smsToken) && /^\d{6}$/.test(input.code.trim())
  }
  // Linked-account verification starts from the provider button itself.
  const showSubmit = state.phase !== 'error' && input?.method !== 'oauth'
  const error = 'error' in state ? state.error : undefined
  const formId = `${inputId}-form`
  let smsSendLabel = t('Send code')
  if (props.smsSending) {
    smsSendLabel = t('Sending...')
  } else if (props.smsRetryAfter) {
    smsSendLabel = t('Resend in {{seconds}}s', { seconds: props.smsRetryAfter })
  }

  const selectMethod = (method: string) => {
    switch (method) {
      case 'wechat':
        props.onInputChange({ method, code: '' })
        break
      case 'sms':
        props.onInputChange({ method, code: '', smsToken: '' })
        break
      case '2fa':
        props.onInputChange({ method, code: '' })
        break
      case 'password':
        props.onInputChange({ method, password: '' })
        break
      case 'passkey':
        props.onInputChange({ method })
        break
      case 'oauth':
        props.onInputChange({
          method,
          provider: ready?.requirements.oauth_providers[0]?.slug ?? '',
        })
        break
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onCancel()
      }}
      title={
        <>
          <ShieldCheck className='size-5' />
          {state.request.title ??
            (login ? t('Complete sign-in') : t('Security verification'))}
        </>
      }
      description={
        state.request.description ??
        (login
          ? t('Verify your identity to finish signing in.')
          : t('Confirm your identity before accessing this sensitive action.'))
      }
      contentClassName='sm:max-w-md'
      contentHeight='auto'
      titleClassName='flex items-center gap-2'
      footer={
        <>
          <Button type='button' variant='outline' onClick={props.onCancel}>
            {t('Cancel')}
          </Button>
          {state.phase === 'error' && (
            <Button type='button' onClick={props.onRetry}>
              {t('Retry')}
            </Button>
          )}
          {showSubmit && (
            <Button type='submit' form={formId} disabled={!canVerify}>
              {verifying && <Loader2 className='size-4 animate-spin' />}
              {t('Verify')}
            </Button>
          )}
        </>
      }
    >
      {state.phase === 'loading' && (
        <div role='status' className='flex items-center gap-2 py-4'>
          <Loader2 className='size-4 animate-spin' />
          {t('Loading verification methods...')}
        </div>
      )}
      {error && (
        <p role='alert' className='text-destructive text-sm'>
          {t(error)}
        </p>
      )}
      {ready && (
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault()
            if (canVerify) void props.onVerify()
          }}
          className='space-y-4 py-2'
        >
          {!input ? (
            <div className='space-y-2 text-sm'>
              <p>{t('No verification method is available for this action.')}</p>
              {ready.requirements.methods.map(
                (option) =>
                  option.reason && (
                    <p className='text-muted-foreground' key={option.method}>
                      {t(option.reason)}
                    </p>
                  )
              )}
            </div>
          ) : (
            <Tabs value={input.method} onValueChange={selectMethod}>
              <TabsList>
                {ready.requirements.methods.map((option) => (
                  <TabsTrigger
                    key={option.method}
                    value={option.method}
                    disabled={!option.available || verifying}
                  >
                    {t(methodLabels[option.method])}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value='wechat' className='space-y-3'>
                {ready.requirements.wechat_qrcode && (
                  <img
                    src={ready.requirements.wechat_qrcode}
                    alt={t('WeChat login QR code')}
                    className='mx-auto size-48 rounded-lg border object-contain'
                  />
                )}
                <p className='text-muted-foreground text-sm'>
                  <WeChatVerificationHint />
                </p>
                <Label htmlFor={inputId}>{t('WeChat verification code')}</Label>
                <Input
                  id={inputId}
                  autoComplete='one-time-code'
                  inputMode='numeric'
                  maxLength={10}
                  autoFocus
                  disabled={verifying}
                  value={input.method === 'wechat' ? input.code : ''}
                  onChange={(event) =>
                    props.onInputChange({
                      method: 'wechat',
                      code: event.target.value,
                    })
                  }
                />
              </TabsContent>
              <TabsContent value='sms' className='space-y-3'>
                <p className='text-muted-foreground text-sm'>
                  {t('Send a verification code to {{phone}}.', {
                    phone: ready.requirements.phone_masked ?? '',
                  })}
                </p>
                <Label htmlFor={inputId}>{t('SMS verification code')}</Label>
                <div className='flex gap-2'>
                  <Input
                    id={inputId}
                    autoComplete='one-time-code'
                    inputMode='numeric'
                    maxLength={6}
                    autoFocus
                    disabled={verifying || props.smsSending}
                    value={input.method === 'sms' ? input.code : ''}
                    onChange={(event) => {
                      if (input.method === 'sms') {
                        props.onInputChange({
                          ...input,
                          code: event.target.value,
                        })
                      }
                    }}
                  />
                  <Button
                    type='button'
                    variant='outline'
                    disabled={
                      verifying ||
                      props.smsSending ||
                      Boolean(props.smsRetryAfter)
                    }
                    onClick={() => void props.onSendSMS?.()}
                  >
                    {smsSendLabel}
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value='password' className='space-y-2'>
                <Label htmlFor={inputId}>{t('Password')}</Label>
                <Input
                  id={inputId}
                  type='password'
                  autoComplete='current-password'
                  autoFocus
                  disabled={verifying}
                  value={input.method === 'password' ? input.password : ''}
                  onChange={(event) =>
                    props.onInputChange({
                      method: 'password',
                      password: event.target.value,
                    })
                  }
                />
              </TabsContent>
              <TabsContent value='2fa' className='space-y-2'>
                <Label htmlFor={inputId}>
                  {acceptsBackupCode
                    ? t('Authenticator code or backup code')
                    : t('Authenticator code')}
                </Label>
                <Input
                  id={inputId}
                  autoComplete='one-time-code'
                  maxLength={acceptsBackupCode ? 9 : 6}
                  autoFocus
                  disabled={verifying}
                  value={input.method === '2fa' ? input.code : ''}
                  onChange={(event) =>
                    props.onInputChange({
                      method: '2fa',
                      code: event.target.value,
                    })
                  }
                />
                <p className='text-muted-foreground text-sm'>
                  {acceptsBackupCode
                    ? t(
                        'Enter the 6-digit authenticator code or an unused backup code.'
                      )
                    : t('Enter the 6-digit authenticator code.')}
                </p>
              </TabsContent>
              <TabsContent value='passkey' className='space-y-3'>
                <PasskeyDomainSelector
                  domains={props.passkeyDomains}
                  value={input.method === 'passkey' ? input.rpID : undefined}
                  onChange={(rpID) =>
                    props.onInputChange({ method: 'passkey', rpID })
                  }
                  disabled={verifying}
                />
                <p className='text-muted-foreground flex items-center gap-2 text-sm'>
                  <KeyRound className='size-5' />
                  {t(
                    'We will prompt your device to confirm using biometrics or your hardware key.'
                  )}
                </p>
              </TabsContent>
              <TabsContent value='oauth' className='space-y-2'>
                <p className='text-muted-foreground text-sm'>
                  {t(
                    'Continue with an account already linked to your profile.'
                  )}
                </p>
                <div className='flex flex-wrap gap-2'>
                  {ready.requirements.oauth_providers.map((provider) => (
                    <Button
                      key={provider.slug}
                      type='button'
                      disabled={verifying}
                      onClick={() =>
                        void props.onVerify({
                          method: 'oauth',
                          provider: provider.slug,
                        })
                      }
                    >
                      {verifying &&
                        input.method === 'oauth' &&
                        input.provider === provider.slug && (
                          <Loader2 className='size-4 animate-spin' />
                        )}
                      {t('Continue with {{name}}', { name: provider.name })}
                    </Button>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          )}
        </form>
      )}
    </Dialog>
  )
}

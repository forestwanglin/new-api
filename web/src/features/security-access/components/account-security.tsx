import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SecureVerificationDialog } from '@/features/auth/secure-verification'
import { getPhoneChangeStatus } from '@/features/personal-profile/api'
import { PhoneChangeDialog } from '@/features/personal-profile/phone-change-dialog'
import { usePhoneChange } from '@/features/personal-profile/use-phone-change'
import type { UserProfile } from '@/features/profile/types'
import { DeleteAccountDialog } from '@/features/security/components/dialogs/delete-account-dialog'
import { WeChatBindDialog } from '@/features/security/components/dialogs/wechat-bind-dialog'
import { useStatus } from '@/hooks/use-status'

type Props = { profile: UserProfile; onUpdate: () => void }

export function AccountSecurity(props: Props) {
  const { t } = useTranslation()
  const [wechatOpen, setWechatOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const { status, loading, error } = useStatus()
  const phone = useQuery({
    queryKey: ['personal-profile-phone', props.profile.id],
    queryFn: ({ signal }) => getPhoneChangeStatus(signal),
  })
  const phoneChange = usePhoneChange(phone.data)
  let phoneDisplay = t('Not bound')
  if (phone.isPending) phoneDisplay = t('Loading...')
  else if (phone.isError) phoneDisplay = t('Temporarily unavailable')
  else if (phone.data?.phone_masked) phoneDisplay = phone.data.phone_masked
  const wechatBound = Boolean(props.profile.wechat_id)
  let wechatDisplay = t('Not bound')
  if (wechatBound) wechatDisplay = t('Bound')
  else if (loading) wechatDisplay = t('Loading...')
  else if (error || !status?.wechat_login) {
    wechatDisplay = t('Temporarily unavailable')
  }
  return (
    <>
      <section className='sa-group' aria-labelledby='sa-account-title'>
        <h2 id='sa-account-title' className='sa-title'>
          {t('Account security')}
        </h2>
        <p className='sa-description'>
          {t(
            'Manage your bound phone for quick sign-in with verification codes.'
          )}
        </p>
        <div className='sa-field'>
          <Label htmlFor='sa-phone'>{t('Phone number')}</Label>
          <div>
            <div className='sa-binding-row'>
              <Input id='sa-phone' readOnly value={phoneDisplay} />
              <Button
                variant='outline'
                disabled={!phone.data || phone.isError || phoneChange.pending}
                onClick={() => void phoneChange.start()}
              >
                {t(
                  phone.data?.bound
                    ? 'Change phone number'
                    : 'Bind phone number'
                )}
              </Button>
            </div>
            {phone.isError && (
              <p className='sa-error' role='alert'>
                {t('Failed to load phone number')}{' '}
                <Button variant='link' onClick={() => void phone.refetch()}>
                  {t('Retry')}
                </Button>
              </p>
            )}
          </div>
        </div>
        <div className='sa-field'>
          <Label htmlFor='sa-wechat'>{t('WeChat binding')}</Label>
          <div className='sa-binding-row'>
            <Input id='sa-wechat' readOnly value={wechatDisplay} />
            {!wechatBound && (
              <Button
                variant='outline'
                disabled={loading || !!error || !status?.wechat_login}
                onClick={() => setWechatOpen(true)}
              >
                {t('Bind WeChat')}
              </Button>
            )}
          </div>
        </div>
      </section>
      <section className='sa-group' aria-labelledby='sa-delete-title'>
        <div className='sa-danger'>
          <h2 id='sa-delete-title'>{t('Close account')}</h2>
          <p>{t('Permanently delete your account and all data')}</p>
          <Button variant='outline' onClick={() => setDeleteOpen(true)}>
            {t('Request account deletion')}
          </Button>
        </div>
      </section>
      {phone.data && (
        <PhoneChangeDialog
          open={phoneChange.open}
          onOpenChange={phoneChange.onOpenChange}
          bindingAuthorization={phoneChange.bindingAuthorization}
          status={phone.data}
          onSuccess={() => {
            void phone.refetch()
            props.onUpdate()
          }}
        />
      )}
      <SecureVerificationDialog {...phoneChange.verificationDialogProps} />
      <WeChatBindDialog
        open={wechatOpen}
        onOpenChange={setWechatOpen}
        qrCodeUrl={
          typeof status?.wechat_qrcode === 'string' ? status.wechat_qrcode : ''
        }
        onSuccess={props.onUpdate}
      />
      <DeleteAccountDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        username={props.profile.username}
      />
    </>
  )
}

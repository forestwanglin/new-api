import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { ErrorState } from '@/components/error-state'
import { Main } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { SecureVerificationDialog } from '@/features/auth/secure-verification'
import { getUserProfile } from '@/features/profile/api'
import { LanguagePreferencesCard } from '@/features/profile/components/language-preferences-card'
import { api } from '@/lib/api'
import { getUserAvatarFallback } from '@/lib/avatar'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { getPhoneChangeStatus } from './api'
import { PhoneChangeDialog } from './phone-change-dialog'
import { usePhoneChange } from './use-phone-change'

import '@/styles/personal-profile.css'

const profileSchema = z.object({
  nickname: z
    .string()
    .trim()
    .min(1, 'Enter a nickname')
    .max(20, 'Nickname must be at most 20 characters'),
})

export function PersonalProfile() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: { nickname: '' },
  })
  const profileQuery = useQuery({
    queryKey: ['personal-profile', user?.id],
    queryFn: async () => {
      const response = requireServerSuccess(await getUserProfile())
      if (!response.data) throw new Error('Failed to load profile')
      return response.data
    },
  })
  const phoneQuery = useQuery({
    queryKey: ['personal-profile-phone', user?.id],
    queryFn: ({ signal }) => getPhoneChangeStatus(signal),
  })
  const phoneChange = usePhoneChange(phoneQuery.data)
  const profile = profileQuery.data
  const reset = form.reset
  const getFieldState = form.getFieldState
  useEffect(() => {
    if (profile && !getFieldState('nickname').isDirty) {
      reset({ nickname: profile.display_name })
    }
  }, [profile, reset, getFieldState])

  const save = async (values: z.infer<typeof profileSchema>) => {
    if (!profile) return
    try {
      requireServerSuccess(
        (
          await api.put('/api/user/self', {
            username: profile.username,
            display_name: values.nickname,
          })
        ).data
      )
      reset({ nickname: values.nickname })
      const currentUser = useAuthStore.getState().auth.user
      if (currentUser?.id === profile.id) {
        useAuthStore
          .getState()
          .auth.setUser({ ...currentUser, display_name: values.nickname })
      }
      await profileQuery.refetch()
      toast.success(t('Profile updated successfully'))
    } catch (error) {
      handleServerError(error, t('Failed to update profile'))
    }
  }
  const avatarURL = user?.avatar_url
  let phoneDisplay = t('Not bound')
  if (phoneQuery.isPending) phoneDisplay = t('Loading...')
  else if (phoneQuery.isError) phoneDisplay = t('Temporarily unavailable')
  else if (phoneQuery.data?.phone_masked) {
    phoneDisplay = phoneQuery.data.phone_masked
  }
  return (
    <Main className='user-page personal-profile-page'>
      <div className='personal-profile-content'>
        <header className='pp-heading'>
          <h1>{t('Personal Profile')}</h1>
          <p>
            {t('Manage your nickname, phone number and language preferences.')}
          </p>
        </header>
        {profileQuery.isPending && <LoadingState />}
        {profileQuery.isError && (
          <ErrorState
            title={t('Failed to load profile')}
            onRetry={() => void profileQuery.refetch()}
          />
        )}
        {profile && (
          <section className='pp-card' aria-labelledby='pp-basic-title'>
            <h2 id='pp-basic-title'>{t('Basic Information')}</h2>
            <p className='pp-card-description'>
              {t('Keep your account details up to date.')}
            </p>
            <form onSubmit={form.handleSubmit(save)}>
              <div className='pp-field'>
                <span className='pp-label'>{t('Avatar')}</span>
                <div className='pp-avatar-row'>
                  <Avatar className='pp-avatar'>
                    <AvatarImage
                      src={avatarURL || undefined}
                      alt={t('Avatar')}
                    />
                    <AvatarFallback className='pp-avatar-fallback'>
                      {getUserAvatarFallback(
                        profile.display_name || profile.username
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type='button'
                              variant='outline'
                              className='pp-button pp-outline'
                              aria-disabled='true'
                              aria-label={t('Change avatar')}
                            >
                              {t('Change')}
                            </Button>
                          }
                        />
                        <TooltipContent>
                          {t('Temporarily unavailable')}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <p className='pp-hint'>
                      {t('Custom avatars are not available yet.')}
                    </p>
                  </div>
                </div>
              </div>
              <div className='pp-field'>
                <Label className='pp-label' htmlFor='pp-nickname'>
                  {t('Nickname')}
                </Label>
                <div>
                  <Input
                    className='pp-input'
                    id='pp-nickname'
                    type='text'
                    maxLength={20}
                    aria-invalid={!!form.formState.errors.nickname}
                    aria-describedby='pp-nickname-hint pp-nickname-error'
                    {...form.register('nickname')}
                  />
                  <p className='pp-hint' id='pp-nickname-hint'>
                    {t(
                      'Shown in the top-right account menu; does not affect API calls.'
                    )}
                  </p>
                  {form.formState.errors.nickname && (
                    <p className='pp-error' id='pp-nickname-error' role='alert'>
                      {t(
                        form.formState.errors.nickname.message ||
                          'Enter a nickname'
                      )}
                    </p>
                  )}
                </div>
              </div>
              <div className='pp-field'>
                <Label className='pp-label' htmlFor='pp-bound-phone'>
                  {t('Phone number')}
                </Label>
                <div>
                  <div className='pp-phone-row'>
                    <Input
                      className='pp-input'
                      id='pp-bound-phone'
                      type='text'
                      readOnly
                      value={phoneDisplay}
                    />
                    <Button
                      type='button'
                      variant='outline'
                      className='pp-button pp-outline'
                      disabled={!phoneQuery.data || phoneChange.pending}
                      onClick={() => void phoneChange.start()}
                    >
                      {t(
                        phoneQuery.data?.bound
                          ? 'Change phone number'
                          : 'Bind phone number'
                      )}
                    </Button>
                  </div>
                  <p className='pp-hint'>
                    {t(
                      'Used for quick sign-in. Changing the number requires verifying both phones.'
                    )}
                  </p>
                  {phoneQuery.isError && (
                    <div className='pp-error' role='alert'>
                      {t('Failed to load phone number')}{' '}
                      <Button
                        variant='link'
                        type='button'
                        onClick={() => void phoneQuery.refetch()}
                      >
                        {t('Retry')}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              <LanguagePreferencesCard
                profile={profile}
                variant='demo'
                onProfileUpdate={() => void profileQuery.refetch()}
              />
              <div className='pp-field pp-save-row'>
                <span />
                <div>
                  <Button
                    className='pp-button pp-primary'
                    type='submit'
                    disabled={form.formState.isSubmitting}
                  >
                    {t('Save changes')}
                  </Button>
                </div>
              </div>
            </form>
          </section>
        )}
      </div>
      {phoneQuery.data && (
        <PhoneChangeDialog
          open={phoneChange.open}
          onOpenChange={phoneChange.onOpenChange}
          bindingAuthorization={phoneChange.bindingAuthorization}
          status={phoneQuery.data}
          onSuccess={() => {
            void phoneQuery.refetch()
            void profileQuery.refetch()
          }}
        />
      )}
      <SecureVerificationDialog {...phoneChange.verificationDialogProps} />
    </Main>
  )
}

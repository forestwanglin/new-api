import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { readOfficialUIDraft } from '@/features/auth/wechat-official/ui-draft'
import { getUserProfile } from '@/features/profile/api'
import { AccessTokensCard } from '@/features/security/components/access-tokens-card'
import { LoginSessionsCard } from '@/features/security/components/login-sessions-card'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { AccountSecurity } from './components/account-security'

import '@/styles/personal-profile.css'
import '@/styles/security-access.css'

export function SecurityAccess() {
  const userId = useAuthStore((state) => state.auth.user?.id)
  return <SecurityAccessContent key={userId} userId={userId} />
}

function SecurityAccessContent(props: { userId: number | undefined }) {
  const { t } = useTranslation()
  const profile = useQuery({
    queryKey: ['personal-profile', props.userId],
    enabled: props.userId !== undefined,
    queryFn: async () => {
      const response = requireServerSuccess(await getUserProfile())
      if (!response.data) throw new Error('Failed to load profile')
      return response.data
    },
  })
  return (
    <div className='user-page security-access-page flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='sa-content'>
        <header className='sa-heading'>
          <h1>{t('Security & Access')}</h1>
          <p>
            {t(
              'Manage your bound phone and login devices to protect your account and assets.'
            )}
          </p>
        </header>
        {profile.isPending && <LoadingState />}
        {profile.isError && (
          <ErrorState
            title={t('Failed to load profile')}
            onRetry={() => void profile.refetch()}
          />
        )}
        {profile.data && (
          <Tabs
            defaultValue={
              readOfficialUIDraft('token-create') ||
              readOfficialUIDraft('token-edit') ||
              readOfficialUIDraft('token-action')
                ? 'tokens'
                : 'account'
            }
            orientation='vertical'
            className='sa-card sa-settings'
          >
            <TabsList className='sa-nav' aria-label={t('Security & Access')}>
              <TabsTrigger value='account'>{t('Account security')}</TabsTrigger>
              <TabsTrigger value='tokens'>{t('Access Tokens')}</TabsTrigger>
              <TabsTrigger value='devices'>{t('Login devices')}</TabsTrigger>
            </TabsList>
            <div className='sa-panels'>
              <TabsContent value='account'>
                <AccountSecurity
                  profile={profile.data}
                  onUpdate={() => void profile.refetch()}
                />
              </TabsContent>
              <TabsContent value='tokens' className='sa-tokens'>
                <AccessTokensCard />
              </TabsContent>
              <TabsContent value='devices'>
                <LoginSessionsCard variant='demo' />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </div>
    </div>
  )
}

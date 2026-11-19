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
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { User, LogOut, Settings, ShieldCheck, ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SignOutDialog } from '@/components/sign-out-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getPhoneChangeStatus } from '@/features/personal-profile/api'
import { getPointsWallet, pointsWalletKey } from '@/features/points-wallet/api'
import {
  customSubscriptionSelfKey,
  getCustomSubscriptionSelf,
} from '@/features/subscriptions-custom/api'
import useDialogState from '@/hooks/use-dialog'
import { useIsSidebarModuleVisible } from '@/hooks/use-sidebar-config'
import { useUserDisplay } from '@/hooks/use-user-display'
import { toIntlLocale } from '@/i18n/languages'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { formatNumber } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import '@/styles/profile-dropdown.css'

const avatarFallbackClassName = 'font-semibold text-white'

export function ProfileDropdown() {
  const { t, i18n } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = useNavigate()
  const [open, setOpen] = useDialogState()
  const user = useAuthStore((state) => state.auth.user)
  const { displayName } = useUserDisplay(user)
  const isSuperAdmin = user?.role === ROLE.SUPER_ADMIN
  const isSecurityVisible = useIsSidebarModuleVisible('/security-access')
  const isSubscriptionVisible = useIsSidebarModuleVisible('/my-subscription')
  const phone = useQuery({
    queryKey: ['personal-profile-phone', user?.id],
    queryFn: ({ signal }) => getPhoneChangeStatus(signal),
    enabled: !!user?.id && menuOpen,
    meta: { errorToast: false },
  })
  const wallet = useQuery({
    queryKey: pointsWalletKey(user?.id),
    queryFn: getPointsWallet,
    enabled: !!user?.id,
    staleTime: 30000,
    meta: { errorToast: false },
  })
  const subscription = useQuery({
    queryKey: customSubscriptionSelfKey(user?.id),
    queryFn: getCustomSubscriptionSelf,
    enabled: !!user?.id && menuOpen && isSubscriptionVisible,
    staleTime: 30000,
    meta: { errorToast: false },
  })
  const general = wallet.data?.balances.find((item) => item.code === 'GENERAL')
  const gpt = wallet.data?.balances.find((item) => item.code === 'GPT')
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const points =
    !wallet.isError && general && gpt
      ? formatNumber(
          BigInt(general.available_points) + BigInt(gpt.available_points),
          locale
        )
      : '—'
  const active = subscription.data?.items.find(
    (item) =>
      item.id === subscription.data.active_subscription_id &&
      item.status === 'active'
  )
  let subscriptionTitle = t('Loading')
  if (subscription.isError) subscriptionTitle = t('Not available yet')
  else if (subscription.isSuccess) {
    subscriptionTitle = active
      ? active.plan_title || t('Plan {{id}}', { id: active.plan_id })
      : t('No active subscription')
  }
  const avatarName = user?.username || displayName
  const avatarFallback = getUserAvatarFallback(avatarName)
  const avatarFallbackStyle = useMemo(
    () => getUserAvatarStyle(avatarName),
    [avatarName]
  )

  return (
    <>
      <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          render={
            <Button variant='outline' className='profile-account-trigger' />
          }
          aria-label={`${displayName} · ${t('Remaining points')}: ${points}`}
        >
          <Avatar className='profile-account-avatar'>
            <AvatarImage
              src={user?.avatar_url}
              alt={`@${displayName}`}
              referrerPolicy='no-referrer'
            />
            <AvatarFallback
              className={`${avatarFallbackClassName} profile-account-avatar-fallback`}
              style={avatarFallbackStyle}
            >
              {avatarFallback}
            </AvatarFallback>
          </Avatar>
          <span className='profile-account-name'>{displayName}</span>
          <span className='profile-account-points'>
            {points} {t('Points')}
          </span>
          <ChevronDown className='profile-account-chevron' aria-hidden='true' />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='end'
          sideOffset={8}
          className='profile-account-menu'
        >
          <div className='profile-account-head'>
            <div className='profile-account-title'>{displayName}</div>
            <div className='profile-account-secondary'>
              {!phone.isError && phone.data?.bound ? phone.data.phone_masked : ''}
            </div>
          </div>
          <div className='profile-account-balance'>
            <span>{t('Remaining points')}</span>
            <strong>{points}</strong>
          </div>
          {isSubscriptionVisible && (
            <div className='profile-account-subscription'>
              <div className='profile-account-subscription-info'>
                <span>{t('Current subscription')}</span>
                <strong>{subscriptionTitle}</strong>
                {!subscription.isError && active && (
                  <small>
                    {active.billing_cycle === 'year'
                      ? t('Yearly')
                      : t('Monthly')}
                  </small>
                )}
              </div>
              <DropdownMenuItem
                className='profile-account-subscription-action'
                disabled={!subscription.isSuccess}
                render={<Button variant='outline' />}
                onClick={() =>
                  navigate({ to: '/subscription', search: { tab: 'plans' } })
                }
              >
                {active ? t('Renew') : t('Buy')}
              </DropdownMenuItem>
            </div>
          )}

          <DropdownMenuItem
            onClick={() => navigate({ to: '/personal-profile' })}
          >
            <User className='size-4' />
            {t('Profile')}
          </DropdownMenuItem>

          {isSecurityVisible && (
            <DropdownMenuItem
              onClick={() => navigate({ to: '/security-access' })}
            >
              <ShieldCheck className='size-4' />
              {t('Security & Access')}
            </DropdownMenuItem>
          )}

          {isSuperAdmin && (
            <DropdownMenuItem
              onClick={() =>
                navigate({
                  to: '/system-settings/site/$section',
                  params: { section: 'system-info' },
                })
              }
            >
              <Settings className='size-4' />
              {t('System Settings')}
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem variant='destructive' onClick={() => setOpen(true)}>
            <LogOut className='size-4' />
            {t('Sign out')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SignOutDialog open={!!open} onOpenChange={setOpen} />
    </>
  )
}

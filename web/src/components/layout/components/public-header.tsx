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
import { Link, useRouterState } from '@tanstack/react-router'
import { Menu } from 'lucide-react'
import { useCallback, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { LanguageSwitcher } from '@/components/language-switcher'
import { NotificationPopover } from '@/components/notification-popover'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { SystemUpdateAction } from '@/features/system-update/system-update-action'
import { useNotifications } from '@/hooks/use-notifications'
import { useSystemConfig } from '@/hooks/use-system-config'
import { useTopNavLinks } from '@/hooks/use-top-nav-links'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'

import { defaultTopNavLinks } from '../config/top-nav.config'
import type { TopNavLink } from '../types'
import { HeaderLogo } from './header-logo'

export interface PublicHeaderProps {
  navLinks?: TopNavLink[]
  mobileLinks?: TopNavLink[]
  navContent?: React.ReactNode
  showThemeSwitch?: boolean
  showLanguageSwitcher?: boolean
  logo?: React.ReactNode
  siteName?: string
  homeUrl?: string
  leftContent?: React.ReactNode
  rightContent?: React.ReactNode
  showNavigation?: boolean
  showAuthButtons?: boolean
  showNotifications?: boolean
  className?: string
}

export function PublicHeader(props: PublicHeaderProps) {
  const {
    navLinks = defaultTopNavLinks,
    showThemeSwitch = true,
    showLanguageSwitcher = true,
    logo: customLogo,
    siteName: customSiteName,
    homeUrl = '/',
    showAuthButtons = true,
    showNotifications = true,
  } = props

  const { t } = useTranslation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { auth } = useAuthStore()
  const {
    systemName,
    logo: systemLogo,
    loading,
    logoLoaded,
  } = useSystemConfig()
  const dynamicLinks = useTopNavLinks()
  const notifications = useNotifications()
  const routerState = useRouterState()
  const pathname = routerState.location.pathname

  const user = auth.user
  const isAuthenticated = !!user
  const displaySiteName = customSiteName || systemName
  const links = dynamicLinks.length > 0 ? dynamicLinks : navLinks

  let logoContent: ReactNode = (
    <HeaderLogo
      src={systemLogo}
      loading={loading}
      logoLoaded={logoLoaded}
      className='size-full rounded-lg object-contain'
    />
  )
  if (customLogo) logoContent = customLogo
  if (loading) logoContent = <Skeleton className='size-full rounded-lg' />

  let authContent = (
    <Button
      size='sm'
      className='h-auto rounded-[9px] border-0 bg-[#2563eb] px-[18px] py-2.5 text-[15px] leading-[1.62] font-semibold text-white shadow-[0_2px_6px_-2px_#2563eb4d] hover:bg-[#1d4ed8]'
      onClick={() => useLoginModalStore.getState().open()}
    >
      {t('Register / Sign in')}
    </Button>
  )
  if (isAuthenticated) authContent = <ProfileDropdown />
  if (loading) authContent = <Skeleton className='h-11 w-32 rounded-[9px]' />

  const handleNavLinkClick = useCallback(
    (
      event: React.MouseEvent<HTMLAnchorElement>,
      link: TopNavLink,
      closeMobile = false
    ) => {
      if (link.disabled) {
        event.preventDefault()
        return
      }

      if (link.requiresAuth) {
        event.preventDefault()
        if (closeMobile) {
          setMobileOpen(false)
        }
        useLoginModalStore.getState().open({ redirectTo: link.href })
        return
      }

      if (closeMobile) {
        setMobileOpen(false)
      }
    },
    []
  )

  return (
    <header
      className={cn(
        'bg-background/95 fixed inset-x-0 top-0 z-40 h-16 border-b backdrop-blur-md',
        props.className
      )}
    >
      <div className='mx-auto h-full max-w-[1200px] px-3 sm:px-7'>
        <nav className='flex h-full min-w-0 items-center gap-2 lg:gap-9'>
          {/* Logo */}
          <div className='flex min-w-0 flex-1 items-center gap-1 lg:flex-none'>
            <Link
              to={homeUrl}
              className='group flex min-w-0 items-center gap-2.5'
            >
              <div className='flex size-[30px] shrink-0 items-center justify-center transition-all duration-300 group-hover:scale-105'>
                {logoContent}
              </div>
              <span
                className='max-w-48 truncate text-[17px] font-bold tracking-[-0.2px]'
                title={displaySiteName}
              >
                {loading ? <Skeleton className='h-4 w-16' /> : displaySiteName}
              </span>
            </Link>
            <SystemUpdateAction presentation='version' />
          </div>

          {props.leftContent}
          {/* Desktop nav */}
          <div className='hidden min-w-0 items-center gap-0.5 lg:flex'>
            {props.navContent ??
              (props.showNavigation !== false &&
                links.map((link) => {
                  const isActive = pathname === link.href
                  if (link.external) {
                    return (
                      <a
                        key={`${link.title}:${link.href}`}
                        href={link.href}
                        title={t(link.title)}
                        target='_blank'
                        rel='noopener noreferrer'
                        aria-disabled={link.disabled}
                        tabIndex={link.disabled ? -1 : undefined}
                        onClick={(event) => handleNavLinkClick(event, link)}
                        className={cn(
                          'text-muted-foreground hover:text-foreground min-w-0 truncate rounded-[8px] px-[15px] py-2 text-[15px] leading-[1.62] transition-colors duration-150',
                          link.disabled && 'pointer-events-none opacity-50'
                        )}
                      >
                        {t(link.title)}
                      </a>
                    )
                  }
                  return (
                    <Link
                      key={`${link.title}:${link.href}`}
                      to={link.href}
                      title={t(link.title)}
                      disabled={link.disabled}
                      onClick={(event) => handleNavLinkClick(event, link)}
                      className={cn(
                        'min-w-0 truncate rounded-[8px] px-[15px] py-2 text-[15px] leading-[1.62] transition-colors duration-150',
                        isActive
                          ? 'bg-accent text-foreground font-semibold'
                          : 'text-muted-foreground hover:text-foreground',
                        link.disabled && 'pointer-events-none opacity-50'
                      )}
                    >
                      {t(link.title)}
                    </Link>
                  )
                }))}
          </div>

          <div className='ms-auto flex shrink-0 items-center gap-1 sm:gap-2.5'>
            {props.rightContent ?? (
              <div className='flex shrink-0 items-center sm:gap-1 [&>button]:size-8 sm:[&>button]:size-9'>
                {(showLanguageSwitcher ||
                  showThemeSwitch ||
                  showNotifications) && (
                  <div className='bg-border/40 mx-2 hidden h-4 w-px lg:block' />
                )}

                {showLanguageSwitcher && <LanguageSwitcher />}
                {showThemeSwitch && <ThemeSwitch />}
                {showNotifications && (
                  <NotificationPopover
                    open={notifications.popoverOpen}
                    onOpenChange={notifications.setPopoverOpen}
                    unreadCount={notifications.unreadCount}
                    activeTab={notifications.activeTab}
                    onTabChange={notifications.setActiveTab}
                    notice={notifications.notice}
                    announcements={notifications.announcements}
                    loading={notifications.loading}
                  />
                )}

                {showAuthButtons && (
                  <>
                    <div className='bg-border/40 mx-1 hidden h-4 w-px sm:block' />
                    {authContent}
                  </>
                )}
              </div>
            )}
            {/* Mobile: compact actions + hamburger */}
            {props.showNavigation !== false && (
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger
                  render={
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='size-9 shrink-0 lg:hidden'
                    />
                  }
                  aria-label={t('Toggle navigation menu')}
                >
                  <Menu className='size-5' />
                </SheetTrigger>
                <SheetContent className='overflow-y-auto p-6' side='right'>
                  <SheetTitle>{t('Toggle navigation menu')}</SheetTitle>
                  <nav className='flex flex-col gap-1'>
                    {(props.mobileLinks ?? links).map((link) => (
                      <Button
                        nativeButton={false}
                        role='link'
                        key={`${link.title}:${link.href}`}
                        variant='ghost'
                        className='justify-start'
                        disabled={link.disabled}
                        render={
                          link.external ? (
                            <a
                              href={link.href}
                              target='_blank'
                              rel='noopener noreferrer'
                              onClick={(event) =>
                                handleNavLinkClick(event, link, true)
                              }
                            />
                          ) : (
                            <Link
                              to={link.href}
                              onClick={(event) =>
                                handleNavLinkClick(event, link, true)
                              }
                            />
                          )
                        }
                      >
                        {t(link.title)}
                      </Button>
                    ))}
                  </nav>
                  {showAuthButtons && (
                    <Link
                      to='/dashboard'
                      onClick={(event) => {
                        setMobileOpen(false)
                        if (!isAuthenticated) {
                          event.preventDefault()
                          useLoginModalStore.getState().open()
                        }
                      }}
                      className='bg-primary text-primary-foreground mt-auto rounded-lg px-4 py-3 text-center text-sm font-medium'
                    >
                      {isAuthenticated
                        ? t('Go to Dashboard')
                        : t('Register / Sign in')}
                    </Link>
                  )}
                </SheetContent>
              </Sheet>
            )}
          </div>
        </nav>
      </div>
    </header>
  )
}

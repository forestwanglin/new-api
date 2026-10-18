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
import { Link } from '@tanstack/react-router'
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  FileText,
  KeyRound,
  RadioTower,
  type LucideIcon,
} from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import {
  CardStaggerContainer,
  CardStaggerItem,
} from '@/components/page-transition'
import { Button } from '@/components/ui/button'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { useDashboardContentVisibility } from '../../hooks/use-status-data'
import { AccessGuideCard } from './access-guide'
import { AnnouncementsPanel } from './announcements-panel'
import { ApiInfoPanel } from './api-info-panel'
import { FAQPanel } from './faq-panel'
import { PerformanceHealthPanel } from './performance-health-panel'
import { ReferralPanel } from './referral-panel'
import { SummaryCards } from './summary-cards'
import { UptimePanel } from './uptime-panel'

type DashboardActionPath =
  | '/keys'
  | '/wallet'
  | '/playground'
  | '/channels'
  | '/usage-logs'
  | '/pricing'

interface QuickAction {
  title: string
  description: string
  to: DashboardActionPath
  icon: LucideIcon
  adminOnly?: boolean
}

const SETUP_GUIDE_EXPANDED_STORAGE_KEY =
  'dashboard_overview_setup_guide_expanded'

function getSavedSetupGuideExpanded(): boolean | null {
  if (typeof window === 'undefined') return null
  const saved = window.localStorage.getItem(SETUP_GUIDE_EXPANDED_STORAGE_KEY)
  if (saved === 'expanded') return true
  if (saved === 'collapsed') return false
  return null
}

function saveSetupGuideExpanded(expanded: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    SETUP_GUIDE_EXPANDED_STORAGE_KEY,
    expanded ? 'expanded' : 'collapsed'
  )
}

function QuickActionItem(props: { action: QuickAction }) {
  const Icon = props.action.icon

  return (
    <Button
      variant='outline'
      className='h-auto justify-start rounded-xl px-3 py-3 text-left'
      render={<Link to={props.action.to} />}
    >
      <span className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg'>
        <Icon className='size-4' aria-hidden='true' />
      </span>
      <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='truncate text-sm font-medium'>
          {props.action.title}
        </span>
        <span className='text-muted-foreground line-clamp-2 text-xs leading-relaxed'>
          {props.action.description}
        </span>
      </span>
    </Button>
  )
}

export function OverviewDashboard() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const {
    apiInfo: showApiInfoPanel,
    announcements: showAnnouncementsPanel,
    faq: showFAQPanel,
    uptimeKuma: showUptimePanel,
  } = useDashboardContentVisibility()
  const isAdmin = Boolean(user?.role && user.role >= ROLE.ADMIN)
  const setupGuideId = useId()
  const [manualSetupGuideExpanded, setManualSetupGuideExpanded] = useState<
    boolean | null
  >(() => getSavedSetupGuideExpanded())
  const setupGuideExpanded = manualSetupGuideExpanded ?? true

  const handleSetupGuideToggle = () => {
    const nextExpanded = !setupGuideExpanded
    setManualSetupGuideExpanded(nextExpanded)
    saveSetupGuideExpanded(nextExpanded)
  }

  const quickActions = useMemo<QuickAction[]>(
    () => [
      {
        title: t('API Keys'),
        description: t('Create a key for your app or service'),
        to: '/keys',
        icon: KeyRound,
      },
      {
        title: t('Channels'),
        description: t('Configure upstream providers and routing.'),
        to: '/channels',
        icon: RadioTower,
        adminOnly: true,
      },
      {
        title: t('Usage Logs'),
        description: t('Inspect requests, errors, and billing details'),
        to: '/usage-logs',
        icon: FileText,
      },
      {
        title: t('Pricing'),
        description: t('Review model rates before scaling traffic'),
        to: '/pricing',
        icon: BookOpen,
      },
    ],
    [t]
  )

  const visibleQuickActions = useMemo(
    () => quickActions.filter((action) => !action.adminOnly || isAdmin),
    [isAdmin, quickActions]
  )

  const showLeftContentPanels =
    isAdmin || showApiInfoPanel || showAnnouncementsPanel || showFAQPanel
  const showContentPanels = showLeftContentPanels || showUptimePanel

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Overview')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='ghost'
          size='sm'
          className='text-muted-foreground hover:text-foreground h-auto min-h-7'
          aria-expanded={setupGuideExpanded}
          aria-controls={setupGuideId}
          onClick={handleSetupGuideToggle}
        >
          {setupGuideExpanded ? (
            <ChevronUp data-icon='inline-start' />
          ) : (
            <ChevronDown data-icon='inline-start' />
          )}
          {t('Setup guide')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-4'>
          <ReferralPanel />
          <div id={setupGuideId} hidden={!setupGuideExpanded}>
            {setupGuideExpanded && (
              <CardStaggerContainer className='grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]'>
                <AccessGuideCard onHide={handleSetupGuideToggle} />
                <CardStaggerItem className='bg-card h-full rounded-2xl border p-4 shadow-xs sm:p-5'>
                  <div className='flex h-full flex-col gap-4'>
                    <div className='flex flex-col gap-1'>
                      <div className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                        {t('Recommended actions')}
                      </div>
                      <h3 className='text-lg font-semibold tracking-tight'>
                        {t('Keep the platform ready')}
                      </h3>
                    </div>
                    <div className='grid gap-2'>
                      {visibleQuickActions.map((action) => (
                        <QuickActionItem key={action.title} action={action} />
                      ))}
                    </div>
                  </div>
                </CardStaggerItem>
              </CardStaggerContainer>
            )}
          </div>

          <SummaryCards />

          {showContentPanels && (
            <CardStaggerContainer
              className={cn(
                'grid grid-cols-1 gap-4',
                showLeftContentPanels &&
                  showUptimePanel &&
                  'xl:grid-cols-[minmax(0,1fr)_22rem]'
              )}
            >
              {showLeftContentPanels && (
                <div
                  className={cn(
                    'grid min-w-0 grid-cols-1 gap-4',
                    (showApiInfoPanel ||
                      showAnnouncementsPanel ||
                      showFAQPanel) &&
                      'lg:grid-cols-2'
                  )}
                >
                  {isAdmin && (
                    <CardStaggerItem className='lg:col-span-2'>
                      <PerformanceHealthPanel />
                    </CardStaggerItem>
                  )}
                  {showApiInfoPanel && (
                    <CardStaggerItem>
                      <ApiInfoPanel />
                    </CardStaggerItem>
                  )}
                  {showAnnouncementsPanel && (
                    <CardStaggerItem>
                      <AnnouncementsPanel />
                    </CardStaggerItem>
                  )}
                  {showFAQPanel && (
                    <CardStaggerItem>
                      <FAQPanel />
                    </CardStaggerItem>
                  )}
                </div>
              )}
              {showUptimePanel && (
                <CardStaggerItem>
                  <UptimePanel />
                </CardStaggerItem>
              )}
            </CardStaggerContainer>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

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
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { CardStaggerContainer } from '@/components/page-transition'
import { AccessGuideCard } from '@/features/dashboard/components/overview/access-guide'
import { RecommendedActionsPanel } from '@/features/dashboard/components/overview/recommended-actions-panel'
import { ReferralPanel } from '@/features/dashboard/components/overview/referral-panel'

export function Onboarding() {
  const { t } = useTranslation()
  return (
    <SectionPageLayout variant='user'>
      <SectionPageLayout.Title>{t('Getting started')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <CardStaggerContainer className='flex min-w-0 flex-col gap-4'>
          <ReferralPanel showStatistics={false} />
          <CardStaggerContainer className='grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]'>
            <AccessGuideCard title={t('Connect your app')} />
            <RecommendedActionsPanel />
          </CardStaggerContainer>
        </CardStaggerContainer>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

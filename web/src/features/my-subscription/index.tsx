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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  customSubscriptionSelfKey,
  getCustomSubscriptionSelf,
} from '@/features/subscriptions-custom/api'
import { CurrentSubscription } from '@/features/subscriptions-custom/current-subscription'
import { SubscriptionSchedule } from '@/features/subscriptions-custom/schedule'
import { useAuthStore } from '@/stores/auth-store'

import '@/styles/subscriptions-custom.css'
import '@/styles/points-account.css'

export function MySubscription() {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const query = useQuery({
    queryKey: customSubscriptionSelfKey(userId),
    queryFn: getCustomSubscriptionSelf,
    enabled: !!userId,
  })
  const active = query.data?.items.find(
    (item) =>
      item.id === query.data.active_subscription_id && item.status === 'active'
  )
  return (
    <SectionPageLayout variant='user'>
      <SectionPageLayout.Title>{t('My subscription')}</SectionPageLayout.Title>
      <SectionPageLayout.Description>
        {t(
          'View your subscription and entitlement schedule, and manage renewal.'
        )}
      </SectionPageLayout.Description>
      <SectionPageLayout.Actions>
        <Button
          role='link'
          variant='outline'
          render={<Link to='/subscription' search={{ tab: 'orders' }} />}
        >
          {t('Subscription orders')}
        </Button>
        <Button
          role='link'
          render={<Link to='/subscription' search={{ tab: 'plans' }} />}
        >
          {t('View subscription plans')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='points-account subscriptions-custom account-subscriptions'>
          <CurrentSubscription />
          <section className='account-card'>
            <h2>{t('Manual renewal')}</h2>
            <p>
              {t(
                'Choose a current subscription offer to renew. The payment confirmation shows the price and credited points.'
              )}
            </p>
            <Button
              role='link'
              variant='outline'
              render={<Link to='/subscription' search={{ tab: 'plans' }} />}
            >
              {t('View renewal offers')}
            </Button>
          </section>
          <section className='account-card'>
            <h2>{t('Auto renewal management')}</h2>
            <div className='account-renewal-fields'>
              <div>
                <span>{t('Current plan')}</span>
                <strong>
                  {active
                    ? active.plan_title ||
                      t('Plan {{id}}', { id: active.plan_id })
                    : t('No active subscription')}
                </strong>
              </div>
              <div>
                <span>{t('Payment method')}</span>
                <strong>{t('Not available yet')}</strong>
              </div>
              <div>
                <span>{t('Activation status')}</span>
                <strong>{t('Not available yet')}</strong>
              </div>
              <div>
                <span>{t('Auto renewal switch')}</span>
                <Switch
                  aria-label={t('Automatic renewal')}
                  checked={false}
                  disabled
                  aria-describedby='renewal-unavailable'
                />
              </div>
            </div>
            <p id='renewal-unavailable'>
              {t(
                'Automatic renewal is not available yet. One-time purchases do not authorize future charges.'
              )}
            </p>
          </section>
          <SubscriptionSchedule plans={[]} />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

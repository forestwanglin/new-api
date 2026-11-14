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
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { customSubscriptionSelfKey, getCustomSubscriptionSelf } from './api'
import { SubscriptionTime } from './current-subscription'
import type { PublicSubscriptionPlan } from './plans'

export function SubscriptionSchedule(props: {
  plans: PublicSubscriptionPlan[]
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const statusLabels: Record<string, string> = {
    active: t('Active'),
    paused: t('Paused'),
    expired: t('Expired'),
    cancelled: t('Cancelled'),
  }
  const userId = useAuthStore((state) => state.auth.user?.id)
  const query = useQuery({
    queryKey: customSubscriptionSelfKey(userId),
    queryFn: getCustomSubscriptionSelf,
    enabled: !!userId,
    refetchInterval: 10000,
  })
  return (
    <section className='sub-card'>
      <h2>{t('My subscription and entitlement schedule')}</h2>
      <p>
        {t(
          'Higher priority subscriptions activate first. Lower priority time is paused and retained; equal priorities follow payment time.'
        )}
      </p>
      {query.isPending && (
        <LoadingState message={t('Loading subscriptions…')} />
      )}
      {query.isError && (
        <ErrorState
          description={getServerErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.isSuccess && !query.data.items.length && (
        <EmptyState title={t('No purchased subscriptions yet')} />
      )}
      {query.data?.items.map((subscription) => (
        <div key={subscription.id} className='sub-management'>
          <strong>
            {subscription.plan_title ||
              props.plans.find((plan) => plan.id === subscription.plan_id)
                ?.title ||
              t('Plan {{id}}', { id: subscription.plan_id })}
          </strong>
          <span>{statusLabels[subscription.status]}</span>
          <span>
            <SubscriptionTime value={subscription.active_since_at} /> /{' '}
            <SubscriptionTime value={subscription.active_until_at} />
          </span>
          <span>
            {t('Priority {{priority}}', { priority: subscription.priority })}
          </span>
          <span>
            {t('Remaining service: {{seconds}} seconds', {
              seconds: formatNumber(
                BigInt(subscription.remaining_duration_ms) / 1000n,
                locale
              ),
            })}
          </span>
        </div>
      ))}
    </section>
  )
}

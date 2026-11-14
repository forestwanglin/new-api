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
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { customSubscriptionSelfKey, getCustomSubscriptionSelf } from './api'

export function SubscriptionTime(props: { value: string | null }) {
  const { t, i18n } = useTranslation()
  if (props.value === null) return <span>{t('Not available yet')}</span>
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const date = new Date(Number(props.value))
  if (!Number.isFinite(date.getTime())) {
    return <span>{t('Not available yet')}</span>
  }
  return (
    <time dateTime={date.toISOString()}>
      {new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
        hour12: false,
      }).format(date)}
    </time>
  )
}

export function CurrentSubscription() {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const query = useQuery({
    queryKey: customSubscriptionSelfKey(userId),
    queryFn: getCustomSubscriptionSelf,
    enabled: !!userId,
    refetchInterval: 10000,
  })
  const active = query.data?.items.find(
    (item) =>
      item.id === query.data.active_subscription_id && item.status === 'active'
  )
  return (
    <section
      className='sub-card account-current'
      aria-labelledby='current-subscription-title'
    >
      <h2 id='current-subscription-title'>{t('My subscription')}</h2>
      {query.isPending && <LoadingState />}
      {query.isError && (
        <ErrorState
          description={getServerErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.isSuccess && !active && (
        <EmptyState
          title={t('No active subscription')}
          description={t(
            'Choose a subscription plan. Previously credited points remain available.'
          )}
        />
      )}
      {active && (
        <>
          <div className='account-current-heading'>
            <h3>
              {active.plan_title || t('Plan {{id}}', { id: active.plan_id })}
            </h3>
            <span className='account-status'>{t('Active')}</span>
          </div>
          <dl className='account-subscription-fields'>
            <div>
              <dt>{t('Billing cycle')}</dt>
              <dd>
                {active.billing_cycle === 'year' ? t('Yearly') : t('Monthly')}
              </dd>
            </div>
            <div>
              <dt>{t('Active since')}</dt>
              <dd>
                <SubscriptionTime value={active.active_since_at} />
              </dd>
            </div>
            <div>
              <dt>{t('Service expires')}</dt>
              <dd>
                <SubscriptionTime value={active.active_until_at} />
              </dd>
            </div>
          </dl>
          <p>
            {t('Credited points remain valid after the subscription expires.')}
          </p>
        </>
      )}
    </section>
  )
}

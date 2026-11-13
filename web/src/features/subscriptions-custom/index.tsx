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
import { useCallback, useState } from 'react'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PublicSubscriptionRules } from '@/features/custom-subscriptions/rules/public-rules'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { getPublicPlans, publicPlanKey } from './api'
import { SubscriptionCheckout } from './checkout'
import { subscriptionCopy as t } from './copy'
import { SubscriptionsCustomFooter } from './footer'
import { PlanCard } from './plan-card'
import type { Offer } from './plans'
import { SubscriptionSchedule } from './schedule'
import { SupportDialog } from './support-dialog'

import '@/styles/subscriptions-custom.css'

export function SubscriptionsCustom(props: { tradeNo?: string } = {}) {
  const isAuthenticated = useAuthStore((state) => !!state.auth.user)
  const query = useQuery({ queryKey: publicPlanKey, queryFn: getPublicPlans })
  const plans = query.isSuccess ? query.data : []
  const [supportOpen, setSupportOpen] = useState(false)
  const [selection, setPending] = useState<Offer | null>(null)
  const selectedPlan = plans.find((plan) => plan.id === selection?.plan.id)
  const pending =
    selection && selectedPlan
      ? {
          ...selection,
          plan: selectedPlan,
          yearly: selectedPlan.billing_cycle === 'year',
          auto: false,
        }
      : null
  const select = useCallback((offer: Offer) => setPending(offer), [])
  const closeCheckout = useCallback(() => setPending(null), [])
  return (
    <PublicLayout showMainContainer={false}>
      <main className='pt-20'>
        {' '}
        <div className='subscriptions-custom'>
          <header className='sub-page-head'>
            <h1>{t('Subscription plans')}</h1>
            <p>
              {t(
                'Compare monthly and yearly plans · One-time purchase / Auto renewal · Points never expire'
              )}
            </p>
          </header>
          <SubscriptionCheckout
            selection={pending}
            onClose={closeCheckout}
            tradeNo={props.tradeNo}
            plans={plans}
            onSelect={select}
          />
          <Tabs defaultValue='plans'>
            <TabsList variant='line' aria-label={t('Subscription features')}>
              <TabsTrigger value='plans'>
                {t('Subscription service')}
              </TabsTrigger>
              {isAuthenticated && (
                <>
                  <TabsTrigger value='orders'>{t('Orders')}</TabsTrigger>
                  <TabsTrigger value='invoices'>{t('Invoices')}</TabsTrigger>
                </>
              )}
            </TabsList>
            <TabsContent value='plans'>
              <section className='sub-service-guide'>
                <h2>
                  {t(
                    'Points balance and subscription service are managed separately'
                  )}
                </h2>
                <p>
                  <strong>{t('Points balance:')}</strong>
                  {t(
                    'Credited in full after payment, valid forever. Expiry or cancellation does not remove credited points; usage remains subject to applicable scope.'
                  )}
                </p>
                <p>
                  <strong>{t('Subscription service:')}</strong>
                  {t(
                    'Monthly service lasts 30 days; yearly service lasts 365 days. Higher priority is active first; equal priorities follow payment time.'
                  )}
                </p>
              </section>
              <p className='sub-muted'>
                {t(
                  'Choose a monthly or yearly plan. Prices, points and renewal rewards follow the configured offer.'
                )}
              </p>
              {query.isPending && (
                <LoadingState message={t('Loading subscription plans…')} />
              )}
              {query.isError && (
                <ErrorState
                  description={getServerErrorMessage(query.error)}
                  onRetry={() => void query.refetch()}
                />
              )}
              {query.isSuccess && !plans.length && (
                <EmptyState title={t('No subscription plans')} />
              )}
              {query.isSuccess &&
                plans.length > 0 &&
                ([false, true] as const).map((yearly) => (
                  <section className='sub-cycle-block' key={String(yearly)}>
                    <div className='sub-cycle-heading'>
                      <h2>
                        {yearly
                          ? t('Subscription yearly')
                          : t('Subscription monthly')}
                      </h2>
                      <p>
                        {yearly
                          ? t(
                              'Twelve months per term; prices and points follow each yearly plan'
                            )
                          : t('One month per term; choose the points you need')}
                      </p>
                    </div>
                    <div className='sub-cycle-grid'>
                      {plans
                        .filter(
                          (plan) =>
                            plan.billing_cycle === (yearly ? 'year' : 'month')
                        )
                        .map((plan) => {
                          const offer = { plan, yearly, auto: false }
                          return (
                            <PlanCard
                              key={plan.id}
                              offer={offer}
                              enabled={false}
                              onSelect={select}
                              onCancel={() => {}}
                            />
                          )
                        })}
                    </div>
                  </section>
                ))}
              {isAuthenticated && (
                <>
                  <section className='sub-card'>
                    <h2>{t('Auto renewal management')}</h2>
                    <p>
                      {t(
                        'Automatic renewal is not available yet. One-time purchases do not authorize future charges.'
                      )}
                    </p>
                  </section>
                  <SubscriptionSchedule plans={plans} />
                </>
              )}
              <section className='sub-card'>
                <h2>{t('Subscription rules')}</h2>
                <PublicSubscriptionRules />
                <Button variant='outline' onClick={() => setSupportOpen(true)}>
                  {t('Contact support')}
                </Button>
              </section>
            </TabsContent>
            {isAuthenticated && (
              <>
                <TabsContent value='orders'>
                  <section className='sub-card'>
                    <h2>{t('Subscription orders')}</h2>
                    <p className='sub-empty'>
                      {t(
                        'The current payment result appears above. Complete order history is not available yet.'
                      )}
                    </p>
                    <p>
                      {t(
                        'Invoices use actual payments only; promotional points, renewal bonuses and referral rewards are not invoiced again.'
                      )}
                    </p>
                  </section>
                </TabsContent>
                <TabsContent value='invoices'>
                  <section className='sub-card'>
                    <h2>{t('Invoices')}</h2>
                    <p className='sub-empty'>
                      {t('Invoice requests are not available yet.')}
                    </p>
                  </section>
                </TabsContent>
              </>
            )}
          </Tabs>
        </div>
      </main>
      <SupportDialog open={supportOpen} onOpenChange={setSupportOpen} />
      <SubscriptionsCustomFooter onContact={() => setSupportOpen(true)} />
    </PublicLayout>
  )
}

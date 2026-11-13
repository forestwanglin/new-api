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
import { useState } from 'react'

import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatPlanPrice } from '@/features/custom-subscriptions/lib/format'
import { PublicSubscriptionRules } from '@/features/custom-subscriptions/rules/public-rules'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { getPublicPlans, publicPlanKey } from './api'
import { subscriptionCopy as t } from './copy'
import { SubscriptionsCustomFooter } from './footer'
import { PlanCard } from './plan-card'
import { offerId, type Offer } from './plans'
import { SupportDialog } from './support-dialog'

import '@/styles/subscriptions-custom.css'

export function SubscriptionsCustom() {
  const query = useQuery({ queryKey: publicPlanKey, queryFn: getPublicPlans })
  const plans = query.isSuccess ? query.data : []
  const [supportOpen, setSupportOpen] = useState(false)
  const [selection, setPending] = useState<Offer | null>(null)
  const selectedPlan = plans.find((plan) => plan.id === selection?.plan.id)
  const pending =
    selection &&
    selectedPlan &&
    (!selection.auto || selectedPlan.auto_renew_enabled)
      ? {
          ...selection,
          plan: selectedPlan,
          yearly: selectedPlan.billing_cycle === 'year',
        }
      : null
  const [enabled, setEnabled] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [payment, setPayment] = useState<string | null>('alipay')
  const [message, setMessage] = useState('')
  const select = (offer: Offer) => {
    setConsent(false)
    setPayment('alipay')
    setPending(offer)
  }
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
          <aside className='sub-demo-notice'>
            {t(
              'Frontend demo only. No payment, authorization, points or subscription changes will be made.'
            )}
          </aside>
          {message && (
            <p role='status' className='sub-demo-notice'>
              {message}
            </p>
          )}
          <Tabs defaultValue='plans'>
            <TabsList variant='line' aria-label={t('Subscription features')}>
              <TabsTrigger value='plans'>
                {t('Subscription service')}
              </TabsTrigger>
              <TabsTrigger value='orders'>{t('Orders')}</TabsTrigger>
              <TabsTrigger value='invoices'>{t('Invoices')}</TabsTrigger>
            </TabsList>
            <TabsContent value='plans'>
              <section className='sub-service-guide'>
                <h2>
                  {t(
                    'Points balance and subscription service are managed separately'
                  )}
                </h2>
                <p>
                  {t(
                    'Points balance: credited in full after payment, valid forever. Expiry or cancellation does not remove credited points; usage remains subject to applicable scope.'
                  )}
                </p>
                <p>
                  {t(
                    'Subscription service: one month per monthly term, twelve months per yearly term. Activation and expiry follow My subscription and entitlement schedule.'
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
                              enabled={
                                plan.auto_renew_enabled &&
                                enabled === offerId(offer)
                              }
                              onSelect={select}
                              onCancel={() => {
                                setEnabled(null)
                                setMessage(
                                  t(
                                    'Demo canceled. No payment or subscription has been made.'
                                  )
                                )
                              }}
                            />
                          )
                        })}
                    </div>
                  </section>
                ))}
              <section className='sub-card'>
                <h2>{t('Auto renewal management')}</h2>
                <div className='sub-management'>
                  <div>
                    <span>{t('Current plan')}</span>
                    <strong>
                      {plans.some(
                        (plan) => plan.auto_renew_enabled && plan.id === enabled
                      )
                        ? t('Demo renewal selection enabled')
                        : t('No demo renewal selection')}
                    </strong>
                  </div>
                  <div>
                    <span>{t('Payment method')}</span>
                    <strong>{t('Demo only — not authorized')}</strong>
                  </div>
                  <Button
                    variant='outline'
                    disabled={
                      !plans.some(
                        (plan) => plan.auto_renew_enabled && plan.id === enabled
                      )
                    }
                    onClick={() => {
                      setEnabled(null)
                      setMessage(
                        t(
                          'Demo canceled. No payment or subscription has been made.'
                        )
                      )
                    }}
                  >
                    {t('Cancel auto renewal')}
                  </Button>
                </div>
              </section>
              <section className='sub-card'>
                <h2>{t('My subscription and entitlement schedule')}</h2>
                <p>
                  {t(
                    'Same-tier renewals extend benefits; upgrades take effect immediately and retain lower-tier time; downgrades follow current and paused terms. New points are credited after payment.'
                  )}
                </p>
                <p className='sub-empty'>
                  {t(
                    'Demo only. Real subscription and entitlement data is not loaded.'
                  )}
                </p>
              </section>
              <section className='sub-card'>
                <h2>{t('Subscription rules')}</h2>
                <PublicSubscriptionRules />
                <Button variant='outline' onClick={() => setSupportOpen(true)}>
                  {t('Contact support')}
                </Button>
              </section>
            </TabsContent>
            <TabsContent value='orders'>
              <section className='sub-card'>
                <h2>{t('Subscription orders')}</h2>
                <p className='sub-empty'>{t('No demo subscription orders.')}</p>
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
                  {t('No demo invoices. Invoice requests are not connected.')}
                </p>
              </section>
            </TabsContent>
          </Tabs>
          <Dialog
            open={!!pending}
            onOpenChange={(open) => {
              if (!open) setPending(null)
            }}
            title={t('Confirm subscription')}
            description={t(
              'Frontend demo only. No payment, authorization, points or subscription changes will be made.'
            )}
            contentClassName='sm:max-w-lg'
            footer={
              <>
                <Button variant='outline' onClick={() => setPending(null)}>
                  {t('Cancel')}
                </Button>
                <Button
                  disabled={!consent}
                  onClick={() => {
                    if (!pending) return
                    if (pending.auto) setEnabled(offerId(pending))
                    setPending(null)
                    setMessage(
                      t(
                        'Demo confirmed. No payment or subscription has been made.'
                      )
                    )
                  }}
                >
                  {t('Confirm demo')}
                </Button>
              </>
            }
          >
            {pending && (
              <div className='space-y-4'>
                <h3 className='font-semibold'>
                  {pending.plan.title} ·{' '}
                  {pending.yearly
                    ? t('Subscription yearly')
                    : t('Subscription monthly')}{' '}
                  · {formatPlanPrice(pending.plan.price_amount_minor, 'zh-CN')}
                </h3>
                <p>
                  {pending.auto
                    ? t(
                        'Auto renewal authorization preview; no payment method will be authorized.'
                      )
                    : t('One-time purchase preview; no payment will be made.')}
                </p>
                <label htmlFor='subscription-payment'>
                  {t('Payment method')}
                </label>
                <Select value={payment} onValueChange={setPayment}>
                  <SelectTrigger id='subscription-payment'>
                    <SelectValue>
                      {payment === 'wechat' ? t('WeChat Pay') : t('Alipay')}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='alipay'>{t('Alipay')}</SelectItem>
                    <SelectItem value='wechat'>{t('WeChat Pay')}</SelectItem>
                  </SelectContent>
                </Select>
                <label className='flex items-start gap-3'>
                  <Checkbox
                    checked={consent}
                    onCheckedChange={(value) => setConsent(value === true)}
                  />
                  {t(
                    'I understand this is a frontend demonstration, not a real purchase or authorization.'
                  )}
                </label>
                <p>
                  {t(
                    'Cancel auto renewal in Subscription → Auto renewal management. Contact support for refunds under applicable rules.'
                  )}
                </p>
              </div>
            )}
          </Dialog>
        </div>
      </main>
      <SupportDialog open={supportOpen} onOpenChange={setSupportOpen} />
      <SubscriptionsCustomFooter onContact={() => setSupportOpen(true)} />
    </PublicLayout>
  )
}

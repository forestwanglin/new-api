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
import { Fragment } from 'react'

import { Button } from '@/components/ui/button'
import { formatPlanPrice } from '@/features/custom-subscriptions/lib/format'
import { usePointName } from '@/features/points/lib/point-name-context'
import { formatNumber } from '@/lib/format'

import { subscriptionCopy as t } from './copy'
import {
  formatOfferPoints,
  offerPointAmounts,
  type Offer,
  type PublicSubscriptionPlan,
} from './plans'

function PlanPoints(props: { plan: PublicSubscriptionPlan; locale: string }) {
  const pointName = usePointName()
  return offerPointAmounts(props.plan, false, pointName).map(
    (entry, index) => (
      <Fragment key={entry.id}>
        {index > 0 && ' + '}
        {formatNumber(entry.amount, props.locale)} <small>{entry.name}</small>
      </Fragment>
    )
  )
}

type Props = {
  offer: Offer
  onSelect: (offer: Offer) => void
}
export function PlanCard(props: Props) {
  const pointName = usePointName()
  const offer = props.offer
  const locale = 'zh-CN'
  const price = formatPlanPrice(offer.plan.price_amount_minor, locale)
  const points = formatOfferPoints(offer.plan, locale, pointName)
  const benefitCounts = new Map<string, number>()
  const benefits = offer.plan.benefits.map((text) => {
    const occurrence = (benefitCounts.get(text) ?? 0) + 1
    benefitCounts.set(text, occurrence)
    return { id: JSON.stringify([text, occurrence]), text }
  })
  const period = offer.yearly ? t('year') : t('month')
  return (
    <article
      className='sub-plan'
      aria-label={`${offer.plan.title} · ${period}`}
    >
      <header className='sub-plan-top'>
        <h3>{offer.plan.title}</h3>
        <span>
          {t('{{count}} months per term', {
            count: offer.plan.duration_months,
          })}
        </span>
      </header>
      {offer.plan.subtitle && (
        <p className='sub-muted'>{offer.plan.subtitle}</p>
      )}
      <div className='sub-purchase-focus'>
        <div className='sub-option-price'>
          {price}
          <small>/ {period}</small>
        </div>
        <div className='sub-current-points'>
          <span>{t('Points credited with this purchase')}</span>
          <strong>
            <PlanPoints plan={offer.plan} locale={locale} />
          </strong>
        </div>
      </div>
      <ul className='sub-plan-benefits'>
        {benefits.map((benefit) => (
          <li key={benefit.id}>{benefit.text}</li>
        ))}
      </ul>
      <section className='sub-option-once'>
        <div className='sub-once-heading'>
          <h4>
            {offer.yearly
              ? t('One-time yearly purchase')
              : t('One-time monthly purchase')}
          </h4>
          <strong>
            {price}
            <small>/ {period}</small>
          </strong>
        </div>
        <p>
          {t('{{points}} credited · buy as needed', {
            points,
          })}
        </p>
        <Button
          variant='default'
          className='sub-purchase-cta'
          onClick={() => props.onSelect({ ...offer, auto: false })}
        >
          {price} · {t('One-time purchase')}
        </Button>
      </section>
    </article>
  )
}

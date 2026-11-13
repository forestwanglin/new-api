import { Fragment } from 'react'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { formatPlanPrice } from '@/features/custom-subscriptions/lib/format'
import { autoBonusPoints } from '@/features/custom-subscriptions/lib/schema'
import { formatNumber } from '@/lib/format'

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
import { subscriptionCopy as t } from './copy'
import {
  formatOfferPoints,
  offerPointAmounts,
  type Offer,
  type PublicSubscriptionPlan,
} from './plans'

function PlanPoints(props: {
  plan: PublicSubscriptionPlan
  locale: string
  renewal?: boolean
}) {
  return offerPointAmounts(props.plan, props.renewal).map((entry, index) => (
    <Fragment key={entry.id}>
      {index > 0 && ' + '}
      {formatNumber(entry.amount, props.locale)} <small>{entry.name}</small>
    </Fragment>
  ))
}

type Props = {
  offer: Offer
  enabled: boolean
  onSelect: (offer: Offer) => void
  onCancel: () => void
}
export function PlanCard(props: Props) {
  const offer = props.offer
  const locale = 'zh-CN'
  const price = formatPlanPrice(offer.plan.price_amount_minor, locale)
  const points = formatOfferPoints(offer.plan, locale)
  const benefitCounts = new Map<string, number>()
  const benefits = offer.plan.benefits.map((text) => {
    const occurrence = (benefitCounts.get(text) ?? 0) + 1
    benefitCounts.set(text, occurrence)
    return { id: JSON.stringify([text, occurrence]), text }
  })
  const extra = autoBonusPoints(
    offer.plan.paid_points,
    offer.plan.bonus_points,
    offer.plan.auto_renew_bonus_bps
  )
  const reward = `${formatNumber(offer.plan.auto_renew_bonus_bps / 100, locale)}%`
  let renewalInstruction = t(
    'Confirm using the switch or button below. Cancel anytime. An existing purchase requires authorization only, with no immediate charge.'
  )
  if (!offer.plan.auto_renew_enabled) {
    renewalInstruction = t('Auto renewal is unavailable for this plan.')
  } else if (props.enabled) {
    renewalInstruction = t(
      'Demo setting only; no scheduled charge. Turn off the switch to cancel.'
    )
  }
  const period = offer.yearly ? t('year') : t('month')
  return (
    <article
      className={`sub-plan ${props.enabled ? 'is-auto-enabled' : ''}`}
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
      <section className='sub-option-auto'>
        <div className='sub-auto-control'>
          <div>
            <h4>
              {t('Auto renewal')}{' '}
              <span className='sub-recommend'>
                {offer.plan.auto_renew_enabled
                  ? t('Recommended')
                  : t('Unavailable')}
              </span>
            </h4>
            <p>
              {t('Future auto renewals add {{rate}} extra points', {
                rate: reward,
              })}
            </p>
          </div>
          <Switch
            checked={props.enabled}
            disabled={!offer.plan.auto_renew_enabled}
            aria-label={`${offer.plan.title} ${period} ${t('Auto renewal')}`}
            onCheckedChange={() =>
              props.enabled
                ? props.onCancel()
                : props.onSelect({ ...offer, auto: true })
            }
          />
        </div>
        <div className='sub-renew-benefit'>
          <span>
            {t('Points credited after each successful automatic payment')}
          </span>
          <strong>
            <PlanPoints plan={offer.plan} locale={locale} renewal />
          </strong>
          <span>
            {t('Includes {{points}} extra', {
              points:
                `${formatNumber(BigInt(extra), locale)} ${offer.plan.auto_bonus_point_type?.name ?? ''}`.trim(),
            })}
          </span>
        </div>
        <p>
          {t(
            'Bonus points start with the first successful automatic renewal payment; authorization alone does not charge or credit points.'
          )}
        </p>
        <p>{renewalInstruction}</p>
        <Button
          disabled={!offer.plan.auto_renew_enabled}
          onClick={() => props.onSelect({ ...offer, auto: true })}
        >
          {price} · {t('Subscribe and enable auto renewal')}
        </Button>
      </section>
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
          variant='outline'
          onClick={() => props.onSelect({ ...offer, auto: false })}
        >
          {price} · {t('One-time purchase')}
        </Button>
      </section>
    </article>
  )
}

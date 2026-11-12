import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
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
import type { Offer } from './plans'

type Props = {
  offer: Offer
  enabled: boolean
  onSelect: (offer: Offer) => void
  onCancel: () => void
}
export function PlanCard(props: Props) {
  const offer = props.offer
  const price = offer.yearly ? offer.plan.yearly : offer.plan.monthly
  const points = offer.plan.monthly * (offer.yearly ? 12000 : 1000)
  const locale = 'zh-CN'
  const number = (value: number) => formatNumber(value, locale)
  const period = offer.yearly ? t('year') : t('month')
  return (
    <article
      className={`sub-plan ${props.enabled ? 'is-auto-enabled' : ''}`}
      aria-label={`${t(offer.plan.name)} · ${period}`}
    >
      <header className='sub-plan-top'>
        <h3>{t(offer.plan.name)}</h3>
        <span>
          {t('{{count}} months per term', { count: offer.yearly ? 12 : 1 })}
        </span>
      </header>
      <div className='sub-purchase-focus'>
        <div className='sub-option-price'>
          ¥{price}
          <small>/ {period}</small>
        </div>
        <div className='sub-current-points'>
          <span>{t('Points credited with this purchase')}</span>
          <strong>
            {number(points)} <small>{t('points')}</small>
          </strong>
        </div>
      </div>
      <ul className='sub-plan-benefits'>
        {offer.plan.benefits.map((text) => (
          <li key={text}>{t(text)}</li>
        ))}
      </ul>
      <section className='sub-option-auto'>
        <div className='sub-auto-control'>
          <div>
            <h4>
              {t('Auto renewal')}{' '}
              <span className='sub-recommend'>{t('Recommended')}</span>
            </h4>
            <p>
              {props.enabled
                ? t('Demo enabled · 10% extra on future auto renewals')
                : t('10% extra points on each future auto renewal')}
            </p>
          </div>
          <Switch
            checked={props.enabled}
            aria-label={`${t(offer.plan.name)} ${period} ${t('Auto renewal')}`}
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
            {number(points * 1.1)} <small>{t('points per term')}</small>
          </strong>
          <span>
            {t('Includes {{points}} extra points', {
              points: number(points / 10),
            })}
          </span>
        </div>
        <p>
          {t(
            'Bonus points start with the first successful automatic renewal payment; authorization alone does not charge or credit points.'
          )}
        </p>
        <p>
          {props.enabled
            ? t(
                'Demo setting only; no scheduled charge. Turn off the switch to cancel.'
              )
            : t(
                'Confirm using the switch or button below. Cancel anytime. An existing purchase requires authorization only, with no immediate charge.'
              )}
        </p>
        <Button onClick={() => props.onSelect({ ...offer, auto: true })}>
          ¥{price} · {t('Subscribe and enable auto renewal')}
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
            ¥{price}
            <small>/ {period}</small>
          </strong>
        </div>
        <p>
          {t('{{points}} points credited · buy as needed', {
            points: number(points),
          })}
        </p>
        <Button
          variant='outline'
          onClick={() => props.onSelect({ ...offer, auto: false })}
        >
          ¥{price} · {t('One-time purchase')}
        </Button>
      </section>
    </article>
  )
}

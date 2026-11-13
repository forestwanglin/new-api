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

import { sideDrawerFormClassName } from '@/components/drawer-layout'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { formatPlanPrice } from '../lib/format'
import { autoBonusPoints } from '../lib/schema'
import type { CustomSubscriptionPlan, PointTypeOption } from '../types'

export function PlanDetails(props: { plan: CustomSubscriptionPlan }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const plan = props.plan
  const typeLabel = (type: PointTypeOption | null) =>
    type ? `${type.name} (${type.code})` : '—'
  const fields = [
    [t('ID'), plan.id],
    [t('Version'), plan.version],
    [t('Plan name'), plan.title],
    [t('Plan code'), plan.code],
    [t('Subtitle'), plan.subtitle || '—'],
    [t('Priority'), formatNumber(plan.priority, locale)],
    [t('Tier code'), plan.tier_code],
    [t('Tier rank'), formatNumber(plan.tier_rank, locale)],
    [
      t('Billing cycle'),
      t(plan.billing_cycle === 'month' ? 'Monthly' : 'Yearly'),
    ],
    [t('Duration (months)'), formatNumber(plan.duration_months, locale)],
    [t('Price (CNY yuan)'), formatPlanPrice(plan.price_amount_minor, locale)],
    [t('Paid points'), formatNumber(BigInt(plan.paid_points), locale)],
    [t('Paid point type'), typeLabel(plan.paid_point_type)],
    [
      t('Regular bonus points'),
      formatNumber(BigInt(plan.bonus_points), locale),
    ],
    [t('Regular bonus point type'), typeLabel(plan.bonus_point_type)],
    [
      t('Automatic renewal'),
      t(plan.auto_renew_enabled ? 'Enabled' : 'Disabled'),
    ],
    [
      t('Automatic renewal bonus (basis points)'),
      formatNumber(plan.auto_renew_bonus_bps, locale),
    ],
    [
      t('Automatic renewal extra points'),
      formatNumber(
        BigInt(
          autoBonusPoints(
            plan.paid_points,
            plan.bonus_points,
            plan.auto_renew_bonus_bps
          )
        ),
        locale
      ),
    ],
    [
      t('Automatic renewal bonus point type'),
      typeLabel(plan.auto_bonus_point_type),
    ],
    [t('Status'), t(plan.enabled ? 'Enabled' : 'Disabled')],
    [t('Sort order'), formatNumber(plan.sort_order, locale)],
    [t('Created at'), new Date(plan.created_at).toLocaleString(locale)],
    [t('Updated at'), new Date(plan.updated_at).toLocaleString(locale)],
  ]
  return (
    <div className={sideDrawerFormClassName()}>
      <dl className='grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2'>
        {fields.map(([label, value]) => (
          <div key={label} className='min-w-0'>
            <dt className='text-muted-foreground text-sm'>{label}</dt>
            <dd className='[overflow-wrap:anywhere] whitespace-pre-wrap'>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <section>
        <h3 className='mb-2 font-medium'>{t('Benefits')}</h3>
        {plan.benefits.length ? (
          <p className='[overflow-wrap:anywhere] whitespace-pre-wrap'>
            {plan.benefits.join('\n')}
          </p>
        ) : (
          <p>—</p>
        )}
      </section>
      <p className='text-muted-foreground text-sm'>
        {t('Configuration only; automatic charging is not connected.')}
      </p>
    </div>
  )
}

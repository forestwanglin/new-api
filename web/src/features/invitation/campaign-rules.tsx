import { useTranslation } from 'react-i18next'

import { type Campaign, formatPoints } from './api'
import { campaignTiers, rateText, tierLabel } from './display'

export function CampaignRules(props: { campaign: Campaign }) {
  const { t } = useTranslation()
  const campaign = props.campaign
  const tiers = campaignTiers(campaign)
  const type = campaign.reward_point_type.name
  const days = campaign.freeze_days
  const rates = tiers.map((tier) => rateText(tier.rate_bps)).join(' / ')
  const examples = tiers
    .map((tier) =>
      formatPoints(((10000n * BigInt(tier.rate_bps)) / 1000n).toString())
    )
    .join(' / ')
  const upgrades = tiers
    .slice(1)
    .map((tier, index) =>
      t(
        'When friend {{threshold}} is first paid, {{previous}} effective friends earn {{before}}. After qualification, subsequent payments earn {{after}}.',
        {
          threshold: tier.min_effective_friends,
          previous: tier.min_effective_friends - 1,
          before: rateText(tiers[index].rate_bps),
          after: rateText(tier.rate_bps),
          interpolation: { escapeValue: false },
        }
      )
    )
    .join(' ')
  const schedule = tiers
    .map(
      (tier, i) =>
        `${tierLabel(tier, tiers[i + 1], t)} ${rateText(tier.rate_bps)}`
    )
    .join('，')
  return (
    <div className='iv-rules-section'>
      <h4>{t('Current activity rules')}</h4>
      <p className='iv-rules-key'>
        {t(
          'The rate is locked at payment; rewards arrive in full after {{days}} days. Higher tiers apply to new orders; earlier orders keep their original rate.',
          { days }
        )}
      </p>
      <ol className='iv-task-rules'>
        <li>
          <strong>{t('Effective friends determine your reward rate')}</strong>
          <p>
            {t('Current activity rewards up to {{rate}}:', {
              rate: rateText(Math.max(...tiers.map((tier) => tier.rate_bps))),
            })}{' '}
            {schedule}。
            {t(
              'Each order earns {{type}} at one rate, for eligible model calls.',
              { type }
            )}
          </p>
        </li>
        <li>
          <strong>
            {t('Rate locked at payment, released in full after {{days}} days', {
              days,
            })}
          </strong>
          <p>
            {t(
              'Direct friends who subscribe or renew during the activity earn rewards based on net payment and your confirmed effective-friend tier at payment. Rewards are released after {{days}} × 24 hours without requiring your friend to spend first.',
              { days }
            )}{' '}
            {t(
              'For a CNY 100 payment, {{rates}} earns {{examples}} {{type}}, respectively.',
              { rates, examples, type, interpolation: { escapeValue: false } }
            )}
          </p>
        </li>
        <li>
          <strong>{t('Higher tiers reward subsequent orders')}</strong>
          <p>
            {t(
              'A direct friend counts once after their first eligible subscription has matured for 7 days without a full refund. Repeat purchases do not increase the count; effective friends carry across months and activities. New orders use the tier confirmed at their payment time, including renewals.'
            )}{' '}
            {upgrades}
          </p>
        </li>
        <li>
          <strong>
            {t('Activity rates change; historical rewards keep their terms')}
          </strong>
          <p>
            {t(
              'The thresholds and rates above come from this activity configuration. An activity ending or changing does not change the rate or release time already locked for paid orders. Historical orders continue under their original rules.'
            )}
          </p>
        </li>
        <li>
          <strong>
            {t('Released rewards are usable; refunds adjust rewards')}
          </strong>
          <p>
            {t(
              'Released {{type}} can be used for eligible model calls according to its configured scope. Pending rewards are shown separately from available wallet points. Cumulative released rewards include previously spent points. Refunds adjust unreleased rewards; orders with released rewards require manual review. Rewards cannot be withdrawn as cash. Self-invitations and abnormal transactions are excluded.',
              { type }
            )}
          </p>
        </li>
      </ol>
      {campaign.rules_text && (
        <div className='iv-additional-rules'>
          <h4>{t('Additional activity rules')}</h4>
          <p className='whitespace-pre-wrap'>{campaign.rules_text}</p>
        </div>
      )}
    </div>
  )
}

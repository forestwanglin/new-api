import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'

import { formatPoints, type Campaign, type getSummary } from './api'
import { CampaignRules } from './campaign-rules'
import {
  campaignTiers,
  invitationTime,
  rateText,
  tierColorProgress,
  tierMeterHeight,
  tierLabel,
} from './display'

type Summary = Awaited<ReturnType<typeof getSummary>>
export function CampaignPanel(props: {
  campaign: Campaign | null
  authenticated: boolean
  summary?: Summary
  summaryPending?: boolean
  share: ReactNode
  onActivities: () => void
}) {
  const { t } = useTranslation()
  const campaign = props.campaign
  const tiers = campaign ? campaignTiers(campaign) : []
  const effective = BigInt(props.summary?.effective_friends ?? '0')
  const current =
    tiers.filter((tier) => effective >= BigInt(tier.min_effective_friends))
      .length - 1
  const next = tiers[current + 1]
  const start = tiers[current]?.min_effective_friends ?? 0
  const remaining = next ? BigInt(next.min_effective_friends) - effective : 0n
  let progressTitle = t('No active invitation campaign')
  if (campaign) {
    progressTitle = next
      ? t('Invite {{count}} more effective friends to reach {{rate}}', {
          count: remaining.toString(),
          rate: rateText(next.rate_bps),
        })
      : t('Highest reward tier reached')
  }
  return (
    <section className='iv-activity'>
      <div className='iv-hero'>
        <div>
          <div className='iv-campaign-head'>
            <div className='iv-campaign-meta'>
              <span className='iv-period'>
                {campaign
                  ? t('Period {{period}} invitation activity', {
                      period: campaign.period,
                    })
                  : t('No active invitation campaign')}
              </span>
              {campaign && (
                <span className='iv-status iv-active'>
                  {t('Invitation activity active')}
                </span>
              )}
            </div>
            <Button
              variant='ghost'
              className='iv-link-action'
              aria-label={t('All activities')}
              onClick={props.onActivities}
            >
              {t('All activities')} →
            </Button>
          </div>
          <h2>
            {campaign ? (
              <>
                {t('Friends subscribe, earn up to ')}
                <span className='iv-rate-highlight'>
                  {rateText(Math.max(...tiers.map((tier) => tier.rate_bps)))}
                </span>
              </>
            ) : (
              t('Existing rewards continue under their original terms')
            )}
          </h2>
          <div className='iv-hero-note'>
            {campaign && (
              <>
                <strong className='iv-point-badge'>
                  {campaign.reward_point_type.name}
                </strong>
                <p>
                  {t(
                    'Direct friends subscribe or renew. Earn rewards based on net payment and the rate at payment, for eligible model calls.'
                  )}
                </p>
                <p>
                  {t(
                    'Friends stay bound · rewards arrive in full after {{days}} days',
                    { days: campaign.freeze_days }
                  )}
                </p>
              </>
            )}
            {!campaign && (
              <p>
                {t(
                  'Activities are not open yet. Existing paid orders continue to release rewards under their original terms.'
                )}
              </p>
            )}
          </div>
          {campaign && (
            <div
              className='iv-reward-split'
              aria-label={t('Effective friends and reward rates')}
            >
              {tiers.map((tier, i) => (
                <div
                  className='iv-tier'
                  key={tier.min_effective_friends}
                  style={
                    {
                      '--tier-progress': `${tierColorProgress(i, tiers.length)}%`,
                      '--tier-height': `${tierMeterHeight(i, tiers.length)}px`,
                    } as CSSProperties
                  }
                >
                  <span className='iv-tier-people'>
                    {tierLabel(tier, tiers[i + 1], t)}
                  </span>
                  <strong className='iv-tier-rate'>
                    {rateText(tier.rate_bps)}
                  </strong>
                  <span className='iv-tier-meter' aria-hidden='true'>
                    <i />
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className='iv-campaign-date'>
            {campaign ? (
              <>
                <strong className='iv-date-label'>
                  {t('Activity dates')}:
                </strong>
                <span className='iv-date-range'>
                  <time>{invitationTime(campaign.starts_at)}</time> {t('to')}{' '}
                  <time>{invitationTime(campaign.ends_at)}</time>
                </span>
              </>
            ) : (
              t('Rewards on paid orders are not cleared when an activity ends.')
            )}
          </div>
        </div>
        <div className='iv-share-footer'>{props.share}</div>
      </div>
      <section
        className='iv-stages'
        aria-label={t('Cumulative invitation reward tiers')}
      >
        {props.authenticated && !props.summary && (
          <div className='iv-progress-layout'>
            {props.summaryPending ? (
              <LoadingState />
            ) : (
              <p>{t('Unable to load invitation summary')}</p>
            )}
          </div>
        )}
        {props.authenticated && props.summary && (
          <div className='iv-progress-layout'>
            <div>
              <div className='iv-stage-heading'>
                <div>
                  <span className='iv-eyebrow'>
                    {t('My cumulative effective friends')}
                  </span>
                  <h3>{progressTitle}</h3>
                </div>
                <strong>
                  {formatPoints(effective.toString())}
                  <small>
                    {t('Effective friends')}
                    {next &&
                      ` / ${t('Next tier')} ${next.min_effective_friends}`}
                  </small>
                </strong>
              </div>
              {campaign && (
                <progress
                  max={next ? next.min_effective_friends - start : 1}
                  value={next ? Number(effective - BigInt(start)) : 1}
                  aria-label={t('Cumulative invitation progress')}
                />
              )}
              {props.summary && BigInt(props.summary.pending_friends) > 0n && (
                <p className='iv-task-note'>
                  {t('{{count}} friends awaiting 7-day qualification', {
                    count: props.summary.pending_friends,
                  })}
                </p>
              )}
            </div>
            <div className='iv-group-reward'>
              <span>{t('My current reward rate')}</span>
              <strong>
                {props.summary?.current_rate_bps != null && campaign
                  ? rateText(props.summary.current_rate_bps)
                  : '—'}
              </strong>
              <small>
                {t('Applies to future payments; paid orders keep their rate')}
              </small>
            </div>
          </div>
        )}
        {!props.authenticated && (
          <>
            <div className='iv-stage-heading'>
              <div>
                <span className='iv-eyebrow'>
                  {t('More effective friends, higher reward rates')}
                </span>
                {campaign && (
                  <h3>
                    {tiers
                      .map(
                        (tier, i) =>
                          `${tierLabel(tier, tiers[i + 1], t)} ${rateText(tier.rate_bps)}`
                      )
                      .join(' · ')}
                  </h3>
                )}
              </div>
            </div>
            <p className='iv-task-note'>
              {t(
                'Sign in to see your effective friends and current reward rate.'
              )}
            </p>
          </>
        )}
        {campaign && <CampaignRules campaign={campaign} />}
      </section>
    </section>
  )
}

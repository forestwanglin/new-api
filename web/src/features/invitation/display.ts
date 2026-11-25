import type { TFunction } from 'i18next'

import { formatTimestampToDate } from '@/lib/format'

import type { Campaign } from './api'

export function campaignTiers(campaign: Campaign) {
  return [...campaign.tiers].sort(
    (a, b) => a.min_effective_friends - b.min_effective_friends
  )
}
export function tierLabel(
  tier: Campaign['tiers'][number],
  next: Campaign['tiers'][number] | undefined,
  t: TFunction
) {
  if (!next) {
    if (tier.min_effective_friends === 0) {
      return t('Any number of friends')
    }
    return t('{{count}}+ friends', { count: tier.min_effective_friends })
  }
  return t('{{start}}—{{end}} friends', {
    start: tier.min_effective_friends,
    end: next.min_effective_friends - 1,
  })
}
export function rateText(bps: number) {
  return `${bps / 100}%`
}
export function tierColorProgress(index: number, count: number) {
  if (count <= 1) return 0
  return Math.round((index / (count - 1)) * 100)
}
export function tierMeterHeight(index: number, count: number) {
  if (count <= 1) return 6
  return Math.round(6 + (12 * index) / (count - 1))
}
export function invitationTime(value: string, dateOnly = false) {
  const result = formatTimestampToDate(Number(value), 'milliseconds')
  return dateOnly ? result.slice(0, 10) : result
}

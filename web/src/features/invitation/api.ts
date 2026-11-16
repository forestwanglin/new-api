import { z } from 'zod'

import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/)
const timestamp = decimal.refine((v) => BigInt(v) <= 8640000000000000n)
export const tierSchema = z.object({
  min_effective_friends: z.number().int().nonnegative(),
  rate_bps: z.number().int().nonnegative(),
})
export const campaignSchema = z.object({
  id: decimal,
  code: z.string(),
  period: z.number().int(),
  name: z.string(),
  description: z.string(),
  starts_at: timestamp,
  ends_at: timestamp,
  reward_point_type_id: decimal,
  reward_point_type: z.object({
    id: decimal,
    code: z.string(),
    name: z.string(),
  }),
  freeze_days: z.number().int().nonnegative(),
  tiers: tierSchema.array(),
  rules_text: z.string(),
  visible: z.boolean(),
  status: z.enum(['draft', 'upcoming', 'active', 'ended']),
  version: decimal,
  published_version: decimal.nullable().optional().default(null),
})
export type Campaign = z.infer<typeof campaignSchema>
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    page: z.number().int().positive(),
    page_size: z.number().int().positive(),
    total: decimal,
    items: item.array(),
  })
export const bindingSchema = z.object({
  bound: z.boolean(),
  inviter_code: z.string(),
  inviter_label: z.string(),
  bound_at: timestamp.nullable(),
})
export const summarySchema = z.object({
  bound_friends: decimal,
  effective_friends: decimal,
  pending_friends: decimal,
  current_rate_bps: z.number().int().nullable(),
  next_threshold: z.number().int().nullable(),
  balances: z.array(
    z.object({
      point_type_id: decimal,
      code: z.string(),
      name: z.string(),
      released_total: decimal,
      pending_total: decimal,
      processing_points: decimal,
      frozen_points: decimal,
      cancelled_total: decimal,
      reversed_total: decimal,
    })
  ),
})
export const rewardSchema = z.object({
  id: decimal,
  order_id: decimal,
  order_label: z.string(),
  invitee_label: z.string(),
  campaign_name: z.string(),
  campaign_version: decimal,
  point_type: z.object({ id: decimal, code: z.string(), name: z.string() }),
  paid_amount_minor: decimal,
  net_paid_amount_minor: decimal,
  rate_bps: z.number().int(),
  effective_count: decimal,
  paid_at: timestamp,
  release_at: timestamp,
  original_points: decimal,
  processing_points: decimal,
  frozen_points: decimal,
  released_points: decimal,
  cancelled_points: decimal,
  reversed_points: decimal,
  review_due_points: decimal,
  status: z.string(),
})
export type Reward = z.infer<typeof rewardSchema>
export async function getCurrentCampaign() {
  const r = await api.get('/api/invitation/campaigns/current')
  return campaignSchema.nullable().parse(requireServerSuccess(r.data).data)
}
export async function getCampaigns(page = 1) {
  const r = await api.get('/api/invitation/campaigns', {
    params: { p: page, page_size: 20 },
  })
  return pageSchema(campaignSchema).parse(requireServerSuccess(r.data).data)
}
export async function getSummary() {
  const r = await api.get('/api/invitation/self/summary')
  return summarySchema.parse(requireServerSuccess(r.data).data)
}
export async function getLink() {
  const r = await api.get('/api/invitation/self/link')
  return z
    .object({ code: z.string(), url: z.string().url() })
    .parse(requireServerSuccess(r.data).data)
}
export async function getBinding() {
  const r = await api.get('/api/invitation/self/binding')
  return bindingSchema.parse(requireServerSuccess(r.data).data)
}
export async function bindInvitation(invitation: string, request_id: string) {
  const r = await api.post('/api/invitation/self/binding', {
    invitation,
    request_id,
  })
  return bindingSchema.parse(requireServerSuccess(r.data).data)
}
export async function getFriends(page = 1, pageSize = 20) {
  const r = await api.get('/api/invitation/self/friends', {
    params: { p: page, page_size: pageSize },
  })
  return pageSchema(
    z.object({
      invitee_id: decimal,
      label: z.string(),
      bound_at: timestamp.nullable(),
      qualified_at: timestamp.nullable(),
      status: z.string(),
    })
  ).parse(requireServerSuccess(r.data).data)
}
export async function getRewards(page = 1, pageSize = 20) {
  const r = await api.get('/api/invitation/self/rewards', {
    params: { p: page, page_size: pageSize },
  })
  return pageSchema(rewardSchema).parse(requireServerSuccess(r.data).data)
}
export function formatPoints(value: string) {
  return BigInt(value).toLocaleString('en-US')
}
export function formatMoneyMinor(value: string) {
  const n = BigInt(value)
  return `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`
}

export type CampaignInput = Omit<
  Campaign,
  'id' | 'version' | 'status' | 'reward_point_type' | 'published_version'
>
export async function getAdminCampaigns(page = 1) {
  const r = await api.get('/api/invitation/admin/campaigns', {
    params: { p: page, page_size: 20 },
  })
  return pageSchema(campaignSchema).parse(requireServerSuccess(r.data).data)
}
export async function saveCampaign(input: CampaignInput, campaign?: Campaign) {
  const r = campaign
    ? await api.put(`/api/invitation/admin/campaigns/${campaign.id}`, {
        ...input,
        version: campaign.version,
      })
    : await api.post('/api/invitation/admin/campaigns', input)
  return campaignSchema.parse(requireServerSuccess(r.data).data)
}
export async function campaignAction(
  campaign: Campaign,
  action: 'publish' | 'end'
) {
  const r = await api.post(
    `/api/invitation/admin/campaigns/${campaign.id}/${action}`,
    { version: campaign.version }
  )
  return campaignSchema.parse(requireServerSuccess(r.data).data)
}

export async function getAdminRewards(page = 1) {
  const r = await api.get('/api/invitation/admin/rewards', {
    params: { p: page, page_size: 20 },
  })
  return pageSchema(rewardSchema).parse(requireServerSuccess(r.data).data)
}
export async function prepareRefund(
  orderId: string,
  amount: string,
  requestId: string
) {
  const r = await api.post(
    `/api/invitation/admin/orders/${encodeURIComponent(orderId)}/refunds`,
    { amount_minor: amount, request_id: requestId }
  )
  return z
    .object({ id: decimal })
    .passthrough()
    .parse(requireServerSuccess(r.data).data)
}
export async function completeRefund(
  orderId: string,
  refundId: string,
  amount: string,
  provider: string,
  providerRefundId: string
) {
  const r = await api.post(
    `/api/invitation/admin/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(refundId)}/complete`,
    { amount_minor: amount, provider, provider_refund_id: providerRefundId }
  )
  requireServerSuccess(r.data)
}
export async function cancelRefund(orderId: string, refundId: string) {
  const r = await api.post(
    `/api/invitation/admin/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(refundId)}/cancel`,
    {}
  )
  requireServerSuccess(r.data)
}
export async function reverseReward(
  rewardId: string,
  points: string,
  requestId: string,
  reason: string
) {
  const r = await api.post(
    `/api/invitation/admin/rewards/${encodeURIComponent(rewardId)}/reversal`,
    { points, request_id: requestId, reason }
  )
  requireServerSuccess(r.data)
}

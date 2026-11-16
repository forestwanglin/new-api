import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

import {
  formatPoints,
  formatMoneyMinor,
  type getRewards,
  type getSummary,
} from './api'
import { invitationTime, rateText } from './display'
import { PageControls } from './page-controls'

export function RewardHistory(props: {
  data?: Awaited<ReturnType<typeof getRewards>>
  summary?: Awaited<ReturnType<typeof getSummary>>
  pending: boolean
  error: boolean
  onRetry: () => void
  page: number
  onPageChange: (page: number) => void
}) {
  const { t } = useTranslation()
  return (
    <section className='iv-card iv-history'>
      <Tabs defaultValue='friends'>
        <TabsList
          variant='line'
          className='iv-tabs'
          aria-label={t('Friends and rewards')}
        >
          <TabsTrigger value='friends'>{t('My friends')}</TabsTrigger>
          <TabsTrigger value='rewards'>
            {t('Reward settlement records')}
          </TabsTrigger>
        </TabsList>
        <p className='iv-history-tools'>
          {t(
            '{{friends}} friends · {{effective}} effective paying friends · {{orders}} orders',
            {
              friends: props.summary
                ? formatPoints(props.summary.bound_friends)
                : '—',
              effective: props.summary
                ? formatPoints(props.summary.effective_friends)
                : '—',
              orders: props.data ? formatPoints(props.data.total) : '—',
            }
          )}
        </p>
        {props.pending && <LoadingState />}
        {props.error && <ErrorState onRetry={props.onRetry} />}
        {(['friends', 'rewards'] as const).map((tab) => (
          <TabsContent value={tab} key={tab}>
            {!props.pending &&
              !props.error &&
              (props.data?.items.length ? (
                <Table
                  className='iv-order-table'
                  aria-label={t(
                    tab === 'friends'
                      ? 'Friend subscription orders'
                      : 'Reward settlement records'
                  )}
                >
                  <TableHeader>
                    <TableRow>
                      {(tab === 'friends'
                        ? [
                            'Friend / order',
                            'Net paid',
                            'Reward release time',
                            'Pending reward points',
                            'Released invitation points',
                          ]
                        : [
                            'Friend / original order',
                            'Order reward rate',
                            'Released invitation points',
                            'Pending reward points',
                            'Refund adjustments / notes',
                          ]
                      ).map((key) => (
                        <TableHead key={key}>{t(key)}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {props.data.items.map((reward) => (
                      <TableRow key={reward.id}>
                        <TableCell>
                          {reward.invitee_label}
                          <small>
                            {reward.order_label}
                            {tab === 'rewards' && ` · ${reward.campaign_name}`}
                          </small>
                          <small>{reward.point_type.name}</small>
                        </TableCell>
                        <TableCell>
                          {tab === 'friends'
                            ? `¥${formatMoneyMinor(reward.net_paid_amount_minor)}`
                            : rateText(reward.rate_bps)}
                        </TableCell>
                        {tab === 'friends' ? (
                          <TableCell>
                            {invitationTime(reward.release_at)}
                            <small>{t(reward.status)}</small>
                          </TableCell>
                        ) : (
                          <TableCell>
                            {formatPoints(reward.released_points)}
                          </TableCell>
                        )}
                        <TableCell>
                          {formatPoints(
                            (
                              BigInt(reward.processing_points) +
                              BigInt(reward.frozen_points)
                            ).toString()
                          )}
                        </TableCell>
                        <TableCell>
                          {tab === 'friends' ? (
                            formatPoints(reward.released_points)
                          ) : (
                            <>
                              {t('Cancelled')}:{' '}
                              {formatPoints(reward.cancelled_points)} ·{' '}
                              {t('Reversed')}:{' '}
                              {formatPoints(reward.reversed_points)}
                            </>
                          )}
                          <small>
                            {t(
                              'Locked at payment with {{count}} effective friends',
                              { count: reward.effective_count }
                            )}
                            {tab === 'friends' &&
                              ` · ${rateText(reward.rate_bps)}`}
                          </small>
                          {BigInt(reward.review_due_points) > 0n && (
                            <small>
                              {t('Manual review')}:{' '}
                              {formatPoints(reward.review_due_points)}
                            </small>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className='iv-empty'>
                  {t(
                    tab === 'friends'
                      ? 'No friend subscription orders yet. Invite friends to earn rewards at the payment-time tier.'
                      : 'No reward records yet. Rewards are released according to each order’s original terms.'
                  )}
                </div>
              ))}
          </TabsContent>
        ))}
        {props.data && BigInt(props.data.total) > 20n && (
          <PageControls
            page={props.page}
            total={props.data.total}
            onChange={props.onPageChange}
          />
        )}
      </Tabs>
    </section>
  )
}

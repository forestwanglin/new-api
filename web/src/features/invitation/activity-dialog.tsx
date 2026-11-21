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
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { usePointName } from '@/features/points/lib/point-name-context'

import { getLatestCampaigns } from './api'
import { campaignTiers, invitationTime, rateText, tierLabel } from './display'

export function ActivityDialog(props: {
  open: boolean
  onOpenChange: (value: boolean) => void
}) {
  const { t } = useTranslation()
  const pointName = usePointName()
  const query = useQuery({
    queryKey: ['invitation', 'latest-campaigns'],
    queryFn: getLatestCampaigns,
    enabled: props.open,
  })
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        <span className='iv-modal-head'>
          <span>{t('All activities')}</span>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Close')}
          </Button>
        </span>
      }
      contentClassName='iv-activity-modal'
      showCloseButton={false}
    >
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.isSuccess && (
        <>
          <div className='iv-list-meta'>
            <span>
              {t('{{count}} activities', { count: Number(query.data.total) })}
            </span>
            <span>{t('Latest start first · up to 10 activities')}</span>
          </div>
          {query.data.items.length ? (
            <Table
              className='iv-list-table'
              aria-label={t('Invitation activities')}
            >
              <TableHeader>
                <TableRow>
                  {['Activity', 'Activity dates', 'Reward tiers', 'Status'].map(
                    (key) => (
                      <TableHead key={key}>{t(key)}</TableHead>
                    )
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.map((campaign) => {
                  const tiers = campaignTiers(campaign)
                  return (
                    <TableRow key={campaign.id}>
                      <TableCell>
                        <span className='iv-list-period'>
                          {t('Period {{period}}', { period: campaign.period })}
                        </span>
                        <span className='iv-list-name'>{campaign.name}</span>
                        <strong className='iv-list-title-rate'>
                          {t('Up to {{rate}} reward', {
                            rate: rateText(
                              Math.max(...tiers.map((tier) => tier.rate_bps))
                            ),
                          })}
                        </strong>
                        <p className='iv-list-summary'>
                          {t(
                            'Direct friends subscribe or renew to earn {{type}} at the payment-time tier. Released in full after {{days}} days.',
                            {
                              type: pointName(campaign.reward_point_type),
                              days: campaign.freeze_days,
                            }
                          )}
                        </p>
                      </TableCell>
                      <TableCell className='iv-list-dates'>
                        <time>{invitationTime(campaign.starts_at, true)}</time>
                        <span>{t('to')} </span>
                        <time>{invitationTime(campaign.ends_at, true)}</time>
                      </TableCell>
                      <TableCell>
                        <div className='iv-list-tiers'>
                          {tiers.map((tier, i) => (
                            <div
                              className='iv-list-tier'
                              key={tier.min_effective_friends}
                            >
                              <span>{tierLabel(tier, tiers[i + 1], t)}</span>
                              <strong>{rateText(tier.rate_bps)}</strong>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`iv-status ${campaign.status === 'active' ? 'iv-active' : ''}`}
                        >
                          {t(`Invitation activity ${campaign.status}`)}
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : (
            <div className='iv-empty'>{t('No activities to display')}</div>
          )}
        </>
      )}
    </Dialog>
  )
}

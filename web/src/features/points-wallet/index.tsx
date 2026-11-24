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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { buttonVariants } from '@/components/ui/button'
import { InvitationPendingRewards } from '@/features/invitation/pending'
import { usePointName } from '@/features/points/lib/point-name-context'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { getPointsWallet, pointsWalletKey, type PointWallet } from './api'
import { PointsWalletDetails } from './details'
import { PointsWalletRules } from './rules'

import '@/styles/points-account.css'

function WalletStatistics(props: { wallet: PointWallet }) {
  const { t, i18n } = useTranslation()
  const pointName = usePointName()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const general = props.wallet.balances.find((item) => item.code === 'GENERAL')
  const otherBalances = props.wallet.balances.filter(
    (item) => item.code !== 'GENERAL'
  )
  const total = props.wallet.balances.reduce(
    (sum, item) => sum + BigInt(item.available_points),
    0n
  )
  const cards = [
    {
      title: t('Total credited points'),
      value: formatNumber(total, locale),
      description: t(
        'Available points, subject to configured model and channel rules'
      ),
      total: true,
    },
    {
      title: general
        ? pointName({
            id: general.point_type_id,
            code: general.code,
            name: general.name,
          })
        : 'GENERAL',
      value: general
        ? formatNumber(BigInt(general.available_points), locale)
        : t('Not available yet'),
      description: t('Available for calls matching the configured rules'),
    },
  ]
  return (
    <section className='wallet-stats' aria-label={t('Wallet statistics')}>
      {cards.map((card) => (
        <div
          className={`account-card wallet-stat${card.total ? ' wallet-points' : ''}`}
          key={card.title}
        >
          <h2>{card.title}</h2>
          <div className='wallet-stat-number'>{card.value}</div>
          <p>{card.description}</p>
        </div>
      ))}
      <div className='account-card wallet-stat'>
        <h2>{t('Other points')}</h2>
        {otherBalances.map((balance) => (
          <div key={balance.point_type_id}>
            <span className='text-muted-foreground block text-xs break-words'>
              {pointName({
                id: balance.point_type_id,
                code: balance.code,
                name: balance.name,
              })}
            </span>
            <div className='wallet-stat-number'>
              {formatNumber(BigInt(balance.available_points), locale)}
            </div>
          </div>
        ))}
        {otherBalances.length === 0 && <p>{t('No other points accounts')}</p>}
        <p>{t('Available for calls matching the configured rules')}</p>
      </div>
      <div className='account-card wallet-stat'>
        <h2>{t('Invitation rewards pending release')}</h2>
        {props.wallet.pending_invitation_rewards.map((reward) => (
          <div key={reward.point_type_id}>
            <span className='text-muted-foreground block text-xs break-words'>
              {pointName({
                id: reward.point_type_id,
                code: reward.code,
                name: reward.name,
              })}
            </span>
            <div className='wallet-stat-number'>
              {formatNumber(BigInt(reward.pending_points), locale)}
            </div>
          </div>
        ))}
        {props.wallet.pending_invitation_rewards.length === 0 && (
          <div className='wallet-stat-number'>0</div>
        )}
        <p>
          {t(
            'Pending invitation rewards are excluded from available points until release.'
          )}
        </p>
      </div>
    </section>
  )
}
export function PointsWallet() {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const query = useQuery({
    queryKey: pointsWalletKey(userId),
    queryFn: getPointsWallet,
    enabled: !!userId,
  })
  return (
    <SectionPageLayout variant='user'>
      <SectionPageLayout.Title>{t('Points wallet')}</SectionPageLayout.Title>
      <SectionPageLayout.Description>
        {t('View your point balances, details and configured rules.')}
      </SectionPageLayout.Description>
      <SectionPageLayout.Content>
        <div className='points-account'>
          <div className='mb-6 flex justify-end'>
            <Link to='/subscription' className={buttonVariants()}>
              {t('Buy points')}
            </Link>
          </div>
          {query.isPending && <LoadingState />}
          {query.isError && (
            <ErrorState
              description={getServerErrorMessage(query.error)}
              onRetry={() => void query.refetch()}
            />
          )}
          {query.data && (
            <>
              <WalletStatistics wallet={query.data} />
              <div className='wallet-usage-guide'>
                <p>
                  {t(
                    'Calls use eligible point types according to configured model and channel rules and consumption priorities.'
                  )}
                </p>
              </div>
              <PointsWalletDetails wallet={query.data} />
              <InvitationPendingRewards
                rewards={query.data.pending_invitation_rewards}
              />
            </>
          )}
          <PointsWalletRules />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

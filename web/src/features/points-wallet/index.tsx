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
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { getPointsWallet, pointsWalletKey, type PointWallet } from './api'
import { PointsWalletDetails } from './details'
import { OtherPointsCard, type OtherTypeRow } from './other-points'
import { PointsWalletRules } from './rules'

import '@/styles/points-account.css'

function buildOtherRows(wallet: PointWallet): OtherTypeRow[] {
  const pendingByType = new Map(
    wallet.pending_invitation_rewards.map((reward) => [
      reward.point_type_id,
      reward,
    ])
  )
  const rows: OtherTypeRow[] = wallet.balances
    .filter((balance) => balance.code !== 'GENERAL')
    .map((balance) => ({
      point_type_id: balance.point_type_id,
      code: balance.code,
      name: balance.name,
      available_points: BigInt(balance.available_points),
      pending_points: BigInt(
        pendingByType.get(balance.point_type_id)?.pending_points ?? '0'
      ),
    }))
  const seen = new Set(rows.map((row) => row.point_type_id))
  for (const reward of wallet.pending_invitation_rewards) {
    if (reward.code === 'GENERAL' || seen.has(reward.point_type_id)) continue
    rows.push({
      point_type_id: reward.point_type_id,
      code: reward.code,
      name: reward.name,
      available_points: 0n,
      pending_points: BigInt(reward.pending_points),
    })
  }
  return rows
}

function WalletStatistics(props: { wallet: PointWallet }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const general = props.wallet.balances.find((item) => item.code === 'GENERAL')
  const generalPending = props.wallet.pending_invitation_rewards.find(
    (item) => item.code === 'GENERAL'
  )
  const otherRows = buildOtherRows(props.wallet)
  const cards = [
    {
      title: t('Available general points'),
      value: formatNumber(BigInt(general?.available_points ?? '0'), locale),
      description: t('Available for calls matching the configured rules'),
      available: true,
    },
    {
      title: t('General points pending release'),
      value: formatNumber(
        BigInt(generalPending?.pending_points ?? '0'),
        locale
      ),
      description: t(
        'Pending invitation rewards are excluded from available points until release.'
      ),
    },
  ]
  return (
    <section className='wallet-stats' aria-label={t('Wallet statistics')}>
      {cards.map((card) => (
        <div
          className={`account-card wallet-stat${card.available ? ' wallet-points' : ''}`}
          key={card.title}
        >
          <h2>{card.title}</h2>
          <div className='wallet-stat-number'>{card.value}</div>
          <p>{card.description}</p>
        </div>
      ))}
      <OtherPointsCard
        title={t('Other available points')}
        rows={otherRows}
        value={(row) => row.available_points}
        description={t('Available for calls matching the configured rules')}
      />
      <OtherPointsCard
        title={t('Other points pending release')}
        rows={otherRows}
        value={(row) => row.pending_points}
        description={t(
          'Pending invitation rewards are excluded from available points until release.'
        )}
      />
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

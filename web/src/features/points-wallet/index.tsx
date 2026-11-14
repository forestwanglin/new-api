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

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
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
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const general = props.wallet.balances.find((item) => item.code === 'GENERAL')
  const gpt = props.wallet.balances.find((item) => item.code === 'GPT')
  const total =
    general && gpt
      ? BigInt(general.available_points) + BigInt(gpt.available_points)
      : null
  const cards = [
    {
      title: t('Total credited points'),
      value:
        total === null ? t('Not available yet') : formatNumber(total, locale),
      description: t(
        'General and GPT available points, subject to model eligibility'
      ),
      total: true,
    },
    {
      title: t('General points balance'),
      value: general
        ? formatNumber(BigInt(general.available_points), locale)
        : t('Not available yet'),
      description: t('Applicable to all available models, used first'),
    },
    {
      title: t('GPT-specific points'),
      value: gpt
        ? formatNumber(BigInt(gpt.available_points), locale)
        : t('Not available yet'),
      description: t('Available for eligible GPT model calls'),
    },
    {
      title: t('GPT-specific points · Pending release'),
      value:
        props.wallet.pending_gpt_points === null
          ? t('Not available yet')
          : formatNumber(BigInt(props.wallet.pending_gpt_points), locale),
      description: t(
        'Pending referral rewards are not available yet and are excluded from the available total'
      ),
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
        {t(
          'View your general and GPT-specific points, balance details and points rules.'
        )}
      </SectionPageLayout.Description>
      <SectionPageLayout.Content>
        <div className='points-account'>
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
                  <strong>{t('GPT model calls:')}</strong>{' '}
                  {t(
                    'General points first, then eligible GPT-specific points.'
                  )}
                </p>
                <p>
                  <strong>{t('Other model calls:')}</strong>{' '}
                  {t('Use general points.')}
                </p>
              </div>
              <PointsWalletDetails wallet={query.data} />
            </>
          )}
          <PointsWalletRules />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

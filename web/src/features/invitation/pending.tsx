import { useTranslation } from 'react-i18next'

import type { PointWallet } from '@/features/points-wallet/api'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

export function InvitationPendingRewards(props: {
  rewards: PointWallet['pending_invitation_rewards']
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <section
      className='account-card p-5'
      aria-label={t('Invitation reward details')}
    >
      <h2>{t('Invitation rewards pending release')}</h2>
      <div className='flex flex-wrap gap-4'>
        {props.rewards.map((reward) => (
          <div key={reward.point_type_id} className='min-w-0 break-words'>
            <strong>
              {reward.name || reward.code || reward.point_type_id}
            </strong>
            <p>
              {t('Processing')}:{' '}
              {formatNumber(BigInt(reward.processing_points), locale)}
            </p>
            <p>
              {t('Frozen')}:{' '}
              {formatNumber(BigInt(reward.frozen_points), locale)}
            </p>
          </div>
        ))}
      </div>
      {props.rewards.length === 0 && <p>{t('No rewards yet')}</p>}
      <p>
        {t(
          'Processing and frozen invitation rewards become available only after release.'
        )}
      </p>
    </section>
  )
}

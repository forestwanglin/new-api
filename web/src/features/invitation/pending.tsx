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
import { useTranslation } from 'react-i18next'

import type { PointWallet } from '@/features/points-wallet/api'
import { usePointName } from '@/features/points/lib/point-name-context'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

export function InvitationPendingRewards(props: {
  rewards: PointWallet['pending_invitation_rewards']
}) {
  const { t, i18n } = useTranslation()
  const pointName = usePointName()
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
              {pointName({
                id: reward.point_type_id,
                code: reward.code,
                name: reward.name,
              })}
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

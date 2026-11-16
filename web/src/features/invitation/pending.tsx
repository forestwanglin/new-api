import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { useAuthStore } from '@/stores/auth-store'

import { getSummary, formatPoints } from './api'

export function InvitationPendingRewards() {
  const { t } = useTranslation()
  const userId = useAuthStore((s) => s.auth.user?.id)
  const q = useQuery({
    queryKey: ['invitation', 'summary', userId],
    queryFn: getSummary,
    enabled: !!userId,
  })
  return (
    <section className='account-card p-5'>
      <h2>{t('Invitation rewards pending release')}</h2>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState onRetry={() => void q.refetch()} />}
      <div className='flex flex-wrap gap-4'>
        {q.data?.balances.map((b) => (
          <div key={b.point_type_id}>
            <strong>{b.name}</strong>
            <p>
              {t('Processing')}: {formatPoints(b.processing_points)}
            </p>
            <p>
              {t('Frozen')}: {formatPoints(b.frozen_points)}
            </p>
          </div>
        ))}
      </div>
      {q.data?.balances.length === 0 && <p>{t('No rewards yet')}</p>}
      <p>
        {t(
          'Only invitation rewards are frozen; purchased subscription points are available immediately.'
        )}
      </p>
    </section>
  )
}

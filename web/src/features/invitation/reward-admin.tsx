import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  getAdminRewards,
  reverseReward,
  formatPoints,
  type Reward,
} from './api'
import { PageControls } from './page-controls'

export function InvitationRewardAdmin() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const viewer = useAuthStore((s) => s.auth.user?.id)
  const [page, setPage] = useState(1)
  const q = useQuery({
    queryKey: ['invitation', 'admin', 'rewards', viewer, page],
    queryFn: () => getAdminRewards(page),
  })
  const [target, setTarget] = useState<Reward | null>(null)
  const [points, setPoints] = useState('')
  const [reason, setReason] = useState('')
  const m = useMutation({
    mutationFn: () => {
      if (!target) throw new Error('No invitation reward selected')
      return reverseReward(target.id, points, crypto.randomUUID(), reason)
    },
    onSuccess: () => {
      setTarget(null)
      void qc.invalidateQueries({
        queryKey: ['invitation', 'admin', 'rewards'],
      })
    },
  })
  return (
    <section className='rounded-lg border p-5'>
      <h2 className='font-semibold'>{t('Invitation reward operations')}</h2>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState onRetry={() => void q.refetch()} />}
      <div className='divide-y'>
        {q.data?.items.map((r) => (
          <div key={r.id} className='py-3'>
            <p>
              {r.order_label} · {r.invitee_label} · {r.status}
            </p>
            <p>
              {r.point_type.name}: {formatPoints(r.original_points)} /{' '}
              {t('Released invitation points')}:{' '}
              {formatPoints(r.released_points)} / {t('Review due')}:{' '}
              {formatPoints(r.review_due_points)}
            </p>
            {r.review_due_points !== '0' && (
              <Button
                variant='outline'
                onClick={() => {
                  setTarget(r)
                  setPoints(r.review_due_points)
                }}
              >
                {t('Reverse released reward')}
              </Button>
            )}
          </div>
        ))}
      </div>
      <PageControls
        page={page}
        total={q.data?.total ?? '0'}
        onChange={setPage}
      />
      {m.isError && <ErrorState description={getServerErrorMessage(m.error)} />}
      {target && (
        <div className='mt-4 grid gap-2'>
          <Input
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            placeholder={t('Points to reverse')}
          />
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('Reason')}
          />
          <Button
            onClick={() => m.mutate()}
            disabled={!/^[0-9]+$/.test(points) || !reason || m.isPending}
          >
            {t('Confirm reversal')}
          </Button>
        </div>
      )}
    </section>
  )
}

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorState } from '@/components/error-state'
import { Input } from '@/components/ui/input'
import { getServerErrorMessage } from '@/lib/server-error-message'

import {
  prepareRefund,
  completeRefund,
  cancelRefund,
  reverseReward,
  formatMoneyMinor,
  type Reward,
  type InvitationRefund,
} from './api'

export type InvitationOperation =
  | { kind: 'prepare' | 'reverse'; reward: Reward }
  | { kind: 'complete' | 'cancel'; refund: InvitationRefund }
export function InvitationOperationDialog(props: {
  operation: InvitationOperation
  onClose: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const op = props.operation
  const [amount, setAmount] = useState(
    op.kind === 'reverse' ? op.reward.review_due_points : ''
  )
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [provider, setProvider] = useState('')
  const [evidence, setEvidence] = useState('')
  const [reason, setReason] = useState('')
  const m = useMutation({
    mutationFn: async () => {
      if (op.kind === 'prepare') {
        await prepareRefund(op.reward.order_id, amount, requestId)
      } else if (op.kind === 'reverse') {
        await reverseReward(op.reward.id, amount, requestId, reason)
      } else if (op.kind === 'complete') {
        await completeRefund(
          op.refund.order_id,
          op.refund.id,
          op.refund.amount_minor,
          provider.trim(),
          evidence.trim()
        )
      } else if (op.kind === 'cancel') {
        await cancelRefund(op.refund.order_id, op.refund.id)
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invitation', 'admin'] })
      props.onClose()
    },
  })
  let title = t('Prepare refund')
  if (op.kind === 'complete') title = t('Complete refund')
  if (op.kind === 'cancel') title = t('Cancel refund')
  if (op.kind === 'reverse') title = t('Reverse released reward')
  let valid = true
  if (op.kind === 'prepare' || op.kind === 'reverse') {
    valid = /^[1-9]\d*$/.test(amount) && BigInt(amount) <= 9223372036854775807n
  }
  if (op.kind === 'prepare') {
    valid =
      valid && BigInt(amount || '0') <= BigInt(op.reward.net_paid_amount_minor)
  }
  if (op.kind === 'reverse') {
    valid =
      valid &&
      BigInt(amount || '0') <= BigInt(op.reward.review_due_points) &&
      reason.trim().length > 0
  }
  if (op.kind === 'complete') {
    valid = provider.trim().length > 0 && evidence.trim().length > 0
  }
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !m.isPending) props.onClose()
      }}
      title={title}
      desc={t(
        'Prepare before the provider refund. Complete only after verifying provider evidence. Cancel unsuccessful refunds.'
      )}
      confirmText={title}
      destructive
      isLoading={m.isPending}
      disabled={!valid}
      handleConfirm={() => m.mutate()}
    >
      <fieldset disabled={m.isPending} className='space-y-4'>
        <p className='text-sm'>
          {t('Order ID')}:{' '}
          {'reward' in op ? op.reward.order_id : op.refund.order_id}
        </p>
        {(op.kind === 'prepare' || op.kind === 'reverse') && (
          <label className='block text-sm'>
            {op.kind === 'prepare'
              ? t('Refund amount in minor units')
              : t('Points to reverse')}
            <Input
              inputMode='numeric'
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                setRequestId(crypto.randomUUID())
              }}
            />
          </label>
        )}
        {op.kind === 'prepare' && (
          <p className='text-muted-foreground text-sm'>
            {t('Net paid amount')}: ¥
            {formatMoneyMinor(op.reward.net_paid_amount_minor)}
          </p>
        )}
        {op.kind === 'reverse' && (
          <label className='block text-sm'>
            {t('Reason')}
            <Input
              maxLength={512}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                setRequestId(crypto.randomUUID())
              }}
            />
          </label>
        )}
        {op.kind === 'complete' && (
          <>
            <p>
              {t('Refund amount')}: ¥{formatMoneyMinor(op.refund.amount_minor)}
            </p>
            <label className='block text-sm'>
              {t('Provider')}
              <Input
                maxLength={32}
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              />
            </label>
            <label className='block text-sm'>
              {t('Verified provider refund ID')}
              <Input
                maxLength={128}
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
              />
            </label>
          </>
        )}
        {m.isError && (
          <ErrorState description={getServerErrorMessage(m.error)} />
        )}
      </fieldset>
    </ConfirmDialog>
  )
}

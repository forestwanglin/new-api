import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { prepareRefund, completeRefund, cancelRefund } from './api'

export function InvitationRefundAdmin() {
  const { t } = useTranslation()
  const [order, setOrder] = useState('')
  const [amount, setAmount] = useState('')
  const [refund, setRefund] = useState('')
  const [provider, setProvider] = useState('')
  const [evidence, setEvidence] = useState('')
  const [result, setResult] = useState('')
  const requestId = useRef(crypto.randomUUID())
  const mutation = useMutation({
    mutationFn: async (action: 'prepare' | 'complete' | 'cancel') => {
      if (action === 'prepare') {
        const response = await prepareRefund(order, amount, requestId.current)
        setRefund(response.id)
      }
      if (action === 'complete') {
        await completeRefund(order, refund, amount, provider, evidence)
      }
      if (action === 'cancel') await cancelRefund(order, refund)
      setResult(t('Refund operation recorded'))
    },
  })
  return (
    <section className='rounded-lg border p-5'>
      <h2 className='font-semibold'>{t('Invitation refund registration')}</h2>
      <p>
        {t(
          'Prepare before the provider refund. Complete only after verifying provider evidence. Cancel unsuccessful refunds.'
        )}
      </p>
      <div className='mt-3 grid gap-3 sm:grid-cols-2'>
        <label>
          {t('Order ID')}
          <Input
            value={order}
            disabled={mutation.isPending}
            onChange={(e) => {
              setOrder(e.target.value)
              requestId.current = crypto.randomUUID()
              setRefund('')
            }}
          />
        </label>
        <label>
          {t('Refund amount in minor units')}
          <Input
            value={amount}
            disabled={mutation.isPending}
            onChange={(e) => {
              setAmount(e.target.value)
              requestId.current = crypto.randomUUID()
            }}
          />
        </label>
        <label>
          {t('Refund operation ID')}
          <Input value={refund} onChange={(e) => setRefund(e.target.value)} />
        </label>
        <label>
          {t('Provider')}
          <Input
            value={provider}
            maxLength={32}
            onChange={(e) => setProvider(e.target.value)}
          />
        </label>
        <label>
          {t('Verified provider refund ID')}
          <Input
            value={evidence}
            maxLength={128}
            onChange={(e) => setEvidence(e.target.value)}
          />
        </label>
      </div>
      <div className='mt-3 flex flex-wrap gap-2'>
        <Button
          disabled={
            mutation.isPending || !/^\d+$/.test(order) || !/^\d+$/.test(amount)
          }
          onClick={() => mutation.mutate('prepare')}
        >
          {t('Prepare refund')}
        </Button>
        <Button
          disabled={mutation.isPending || !refund || !provider || !evidence}
          onClick={() => mutation.mutate('complete')}
        >
          {t('Complete refund')}
        </Button>
        <Button
          variant='outline'
          disabled={mutation.isPending || !refund}
          onClick={() => mutation.mutate('cancel')}
        >
          {t('Cancel refund')}
        </Button>
      </div>
      {mutation.isError && (
        <ErrorState description={getServerErrorMessage(mutation.error)} />
      )}
      <p role='status'>{result}</p>
    </section>
  )
}

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
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatPlanPrice } from '@/features/custom-subscriptions/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useLoginModalStore } from '@/stores/login-modal-store'

import { subscriptionCopy as t } from './copy'
import { formatOfferPoints } from './plans'
import {
  useSubscriptionCheckout,
  type SubscriptionCheckoutProps,
} from './use-checkout'

export function SubscriptionCheckout(props: SubscriptionCheckoutProps) {
  const selection = props.selection
  const onClose = props.onClose
  const {
    userId,
    paymentType,
    setPayment,
    requestId,
    resetMutation,
    setRequestId,
    setPlanChanged,
    mutation,
    methods,
    order,
    tradeNo,
    changed,
    statusText,
  } = useSubscriptionCheckout(props)
  return (
    <>
      {tradeNo && (
        <section className='sub-card' aria-label={t('Payment status')}>
          <p role='status'>{statusText}</p>
          <p>
            {t('Order number')}: {tradeNo}
          </p>
          {order.isError && (
            <p role='alert'>{getServerErrorMessage(order.error)}</p>
          )}
          <Button
            variant='outline'
            disabled={order.isFetching || !userId}
            onClick={() => void order.refetch()}
          >
            {t('Refresh payment status')}
          </Button>
          {!userId && (
            <Button
              onClick={() =>
                useLoginModalStore.getState().open({
                  redirectTo: `/subscription?trade_no=${encodeURIComponent(tradeNo)}`,
                })
              }
            >
              {t('Sign in to check payment')}
            </Button>
          )}
        </section>
      )}
      <Dialog
        open={!!selection && !!userId}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) onClose()
        }}
        title={t('Confirm one-time purchase')}
        contentClassName='sub-checkout'
        headerClassName='sub-checkout-header'
        titleClassName='sub-checkout-title'
        bodyClassName='sub-checkout-body'
        footerClassName='sub-checkout-footer'
        overlayClassName='sub-checkout-overlay'
        showCloseButton={false}
        footer={
          <>
            <Button
              variant='outline'
              disabled={mutation.isPending}
              onClick={props.onClose}
            >
              {t('Cancel')}
            </Button>
            <Button
              disabled={
                !paymentType || !selection || mutation.isPending || !!changed
              }
              onClick={() => {
                if (!selection || !paymentType || mutation.isPending) return
                mutation.mutate({
                  plan_id: selection.plan.id,
                  plan_version: selection.plan.version,
                  payment_method: paymentType,
                  request_id: requestId,
                })
              }}
            >
              {mutation.isPending
                ? t('Starting payment…')
                : t('Pay {{price}}', {
                    price: selection
                      ? formatPlanPrice(
                          selection.plan.price_amount_minor,
                          'zh-CN'
                        )
                      : '',
                  })}
            </Button>
          </>
        }
      >
        {selection && (
          <div>
            <div className='sub-order-line'>
              <h3>
                {selection.plan.title} ·{' '}
                {selection.yearly
                  ? t('Subscription yearly')
                  : t('Subscription monthly')}
              </h3>
              <strong>
                {formatPlanPrice(selection.plan.price_amount_minor, 'zh-CN')}
              </strong>
            </div>
            <section className='sub-order-now'>
              <p>
                {t('Payment for this purchase')}{' '}
                <strong>
                  {formatPlanPrice(selection.plan.price_amount_minor, 'zh-CN')}
                </strong>
              </p>
              <p>
                {t('Points credited with this purchase')}{' '}
                <strong>{formatOfferPoints(selection.plan, 'zh-CN')}</strong>，
                {t('Points never expire')}
              </p>
              <p>
                {t('Service duration: {{days}} days.', {
                  days: selection.yearly ? 365 : 30,
                })}
              </p>
              <p>
                {t(
                  'Higher priority subscriptions activate first. Lower priority time is paused and retained; equal priorities follow payment time.'
                )}
              </p>
            </section>
            {methods.isPending && (
              <LoadingState message={t('Loading payment methods…')} />
            )}
            {methods.isError && (
              <ErrorState
                description={getServerErrorMessage(methods.error)}
                onRetry={() => void methods.refetch()}
              />
            )}
            {methods.isSuccess && !methods.data.length && (
              <p role='alert'>
                {t('No payment methods are available. Please contact support.')}
              </p>
            )}
            {!!methods.data?.length && (
              <>
                <label className='sub-pay-label' htmlFor='subscription-payment'>
                  {t('Payment method')}
                </label>
                <Select
                  value={paymentType}
                  onValueChange={(value) => {
                    setPayment(value)
                    setRequestId(crypto.randomUUID())
                    resetMutation()
                  }}
                  disabled={mutation.isPending}
                >
                  <SelectTrigger
                    id='subscription-payment'
                    className='sub-pay-select'
                  >
                    <SelectValue>
                      {
                        methods.data.find(
                          (method) => method.type === paymentType
                        )?.name
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {methods.data.map((method) => (
                        <SelectItem key={method.type} value={method.type}>
                          {method.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </>
            )}
            {mutation.isError && (
              <p role='alert'>{getServerErrorMessage(mutation.error)}</p>
            )}
            {changed && (
              <Button
                onClick={() => {
                  resetMutation()
                  setPlanChanged(false)
                  setRequestId(crypto.randomUUID())
                }}
              >
                {t('Plan changed. Confirm the updated price and points again.')}
              </Button>
            )}
            <p className='sub-order-consent'>
              {t(
                'This is a one-time purchase and does not enable automatic renewal.'
              )}
            </p>
            <p className='sub-order-help'>
              {t('Contact support for refunds under applicable rules.')}
            </p>
          </div>
        )}
      </Dialog>
    </>
  )
}

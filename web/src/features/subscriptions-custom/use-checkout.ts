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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { submitPaymentForm } from '@/features/wallet/lib/payment'
import { getSelf } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'

import {
  createSubscriptionOrder,
  getSubscriptionOrder,
  getSubscriptionPaymentMethods,
  publicPlanKey,
} from './api'
import { subscriptionCopy as t } from './copy'
import type { Offer, PublicSubscriptionPlan } from './plans'

const intentKey = 'custom-subscription-purchase-intent'

export interface SubscriptionCheckoutProps {
  selection: Offer | null
  plans: PublicSubscriptionPlan[]
  onClose: () => void
  onSelect: (offer: Offer) => void
  tradeNo?: string
}
export function useSubscriptionCheckout(props: SubscriptionCheckoutProps) {
  const userId = useAuthStore((state) => state.auth.user?.id)
  const loginOpen = useLoginModalStore((state) => state.isOpen)
  const client = useQueryClient()
  const [payment, setPayment] = useState<string | null>(null)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [planChanged, setPlanChanged] = useState(false)
  const lastPlan = useRef<{ id: string; version: string } | null>(null)
  const [tradeNo, setTradeNo] = useState(props.tradeNo ?? '')
  const waitingLogin = useRef(false)
  const lastUserId = useRef(userId)
  const ownerRef = useRef(userId)
  ownerRef.current = userId
  const handledSuccess = useRef('')
  const selection = props.selection
  const { onClose, onSelect } = props
  const selectedId = selection?.plan.id
  const selectedVersion = selection?.plan.version
  const methods = useQuery({
    queryKey: ['custom-subscription-payment-methods', userId],
    queryFn: getSubscriptionPaymentMethods,
    enabled: !!userId && !!selection,
  })
  const paymentType = methods.data?.some((item) => item.type === payment)
    ? payment
    : (methods.data?.[0]?.type ?? null)
  const mutation = useMutation({
    mutationFn: createSubscriptionOrder,
    meta: { errorToast: false },
    onMutate: () => ({ ownerId: userId }),
    onSuccess: (order, _variables, context) => {
      if (!context?.ownerId || ownerRef.current !== context.ownerId) return
      setTradeNo(order.trade_no)
      sessionStorage.removeItem(intentKey)
      onClose()
      if ('url' in order) submitPaymentForm(order.url, order.params)
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: publicPlanKey })
    },
  })
  const resetMutation = mutation.reset
  const order = useQuery({
    queryKey: ['custom-subscription-order', userId, tradeNo],
    queryFn: () => getSubscriptionOrder(tradeNo),
    enabled: !!userId && !!tradeNo,
    retry: false,
    meta: { errorToast: false },
    refetchInterval: (query) => {
      const done =
        query.state.data?.fulfillment_status === 'fulfilled' ||
        ['failed', 'expired', 'closed', 'cancelled'].includes(
          query.state.data?.status ?? ''
        )
      return done ||
        query.state.dataUpdateCount + query.state.errorUpdateCount >= 30
        ? false
        : 2000
    },
    refetchOnWindowFocus: true,
  })
  useEffect(() => {
    if (lastUserId.current !== undefined && lastUserId.current !== userId) {
      setTradeNo('')
      onClose()
      resetMutation()
      sessionStorage.removeItem(intentKey)
    }
    lastUserId.current = userId
  }, [userId, onClose, resetMutation])
  useEffect(() => {
    if (!selection || userId || waitingLogin.current) return
    waitingLogin.current = true
    sessionStorage.setItem(
      intentKey,
      JSON.stringify({ planId: selection.plan.id, at: Date.now() })
    )
    useLoginModalStore.getState().open({ redirectTo: '/subscription' })
  }, [selection, userId])
  useEffect(() => {
    if (
      !waitingLogin.current ||
      loginOpen ||
      useLoginModalStore.getState().isOpen
    ) {
      return
    }
    waitingLogin.current = false
    sessionStorage.removeItem(intentKey)
    if (!userId) onClose()
  }, [loginOpen, userId, onClose])
  useEffect(() => {
    if (!userId || selection || !props.plans.length) return
    const saved = sessionStorage.getItem(intentKey)
    if (!saved) return
    sessionStorage.removeItem(intentKey)
    try {
      const value: unknown = JSON.parse(saved)
      if (
        !value ||
        typeof value !== 'object' ||
        !('planId' in value) ||
        !('at' in value) ||
        typeof value.at !== 'number' ||
        Date.now() - value.at > 15 * 60 * 1000
      ) {
        return
      }
      const plan = props.plans.find((item) => item.id === value.planId)
      if (plan) {
        onSelect({
          plan,
          yearly: plan.billing_cycle === 'year',
          auto: false,
        })
      }
    } catch {
      /* Invalid local intent never creates an order. */
    }
  }, [userId, selection, props.plans, onSelect])
  useEffect(() => {
    const previous = lastPlan.current
    setPlanChanged(
      !!selectedId &&
        previous?.id === selectedId &&
        previous.version !== selectedVersion
    )
    lastPlan.current =
      selectedId && selectedVersion
        ? { id: selectedId, version: selectedVersion }
        : null
    setRequestId(crypto.randomUUID())
    setPayment(null)
    resetMutation()
  }, [selectedId, selectedVersion, resetMutation])
  useEffect(() => {
    if (props.tradeNo) setTradeNo(props.tradeNo)
  }, [props.tradeNo])
  useEffect(() => {
    if (
      order.data?.fulfillment_status !== 'fulfilled' ||
      handledSuccess.current === tradeNo
    ) {
      return
    }
    handledSuccess.current = tradeNo
    for (const key of [
      ['point-ledger'],
      ['users'],
      ['custom-subscription-self'],
      ['custom-subscription-orders'],
      ['points-wallet'],
    ]) {
      void client.invalidateQueries({ queryKey: key })
    }
    const owner = userId
    void getSelf()
      .then((response) => {
        const current = useAuthStore.getState().auth
        if (current.user?.id === owner && response.success && response.data) {
          current.setUser({ ...current.user, ...response.data })
        }
      })
      .catch(() => {
        /* Status stays successful even if the profile refresh must be retried. */
      })
  }, [order.data, tradeNo, client, userId])
  const changed = planChanged
  let statusText = t(
    'Payment confirmation pending. Your subscription will appear after payment is confirmed.'
  )
  if (order.data?.fulfillment_status === 'fulfilled') {
    statusText = t(
      'Payment successful. Points credited and subscription arranged.'
    )
  } else if (
    ['failed', 'expired', 'closed', 'cancelled'].includes(
      order.data?.status ?? ''
    )
  ) {
    statusText = t(
      'This payment order is closed. Contact support if you have paid.'
    )
  }
  return {
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
  }
}

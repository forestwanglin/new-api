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
import { useState } from 'react'

import { getTopupInfo } from '@/features/wallet/api'
import { AffiliateRewardsCard } from '@/features/wallet/components/affiliate-rewards-card'
import { TransferDialog } from '@/features/wallet/components/dialogs/transfer-dialog'
import { useAffiliate } from '@/features/wallet/hooks'
import type { UserWalletData } from '@/features/wallet/types'
import { getSelf } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

const REFERRAL_QUERY_SCOPE = ['dashboard', 'overview', 'referral'] as const

/**
 * Read the affiliate counters from `/api/user/self` instead of the auth-store
 * snapshot: invite counters change while a session is open (someone registers
 * with the link) and the store is only refreshed on login or route bootstrap.
 */
function useReferralSelf() {
  return useQuery({
    queryKey: [...REFERRAL_QUERY_SCOPE, 'self'],
    queryFn: async () => {
      const result = requireServerSuccess(await getSelf())
      return (result.data ?? null) as UserWalletData | null
    },
    staleTime: 60 * 1000,
  })
}

/**
 * Only the payment-compliance flag is needed here. Reading it through
 * `useTopupInfo` would drag the whole top-up form parsing into this page, so
 * the shared response is consumed directly.
 */
function useReferralCompliance() {
  return useQuery({
    queryKey: [...REFERRAL_QUERY_SCOPE, 'compliance'],
    queryFn: async () => {
      const result = requireServerSuccess(await getTopupInfo())
      return result.data?.payment_compliance_confirmed !== false
    },
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Keep the auth-store balance in step with a transferred reward, so the summary
 * cards rendered next to this panel do not keep showing the pre-transfer value.
 */
function syncBalanceToAuthStore(latest: UserWalletData | null): void {
  if (!latest) return

  const current = useAuthStore.getState().auth.user
  if (!current) return

  useAuthStore.getState().auth.setUser({
    ...current,
    quota: latest.quota,
    used_quota: latest.used_quota,
    request_count: latest.request_count,
    aff_count: latest.aff_count,
    aff_quota: latest.aff_quota,
    aff_history_quota: latest.aff_history_quota,
  })
}

export function ReferralPanel() {
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const {
    affiliateLink,
    loading: affiliateLoading,
    transferQuota,
    transferring,
  } = useAffiliate()
  const selfQuery = useReferralSelf()
  const complianceQuery = useReferralCompliance()

  const handleTransfer = async (amount: number) => {
    const success = await transferQuota(amount)
    if (!success) return false

    const latest = await selfQuery.refetch()
    syncBalanceToAuthStore(latest.data ?? null)
    return true
  }

  return (
    <>
      <AffiliateRewardsCard
        user={selfQuery.data ?? null}
        affiliateLink={affiliateLink}
        onTransfer={() => setTransferDialogOpen(true)}
        complianceConfirmed={complianceQuery.data ?? true}
        loading={affiliateLoading || selfQuery.isPending}
      />
      <TransferDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        onConfirm={handleTransfer}
        availableQuota={selfQuery.data?.aff_quota ?? 0}
        transferring={transferring}
      />
    </>
  )
}

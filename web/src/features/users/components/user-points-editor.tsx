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
import { Pencil } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { getUserPoints } from '../api'
import type { UserPointAccount } from '../types'
import { UserPointsDialog } from './user-points-dialog'

type Props = {
  open: boolean
  userId: number
  onSuccess: () => void
}

function UserPointRow(
  props: Props & { balance: UserPointAccount; disabled: boolean }
) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [open, setOpen] = useState(false)
  const fieldId = useId()
  const balance = props.balance
  const label = `${balance.name || balance.code} (${balance.code})`
  return (
    <div
      role='group'
      aria-labelledby={`${fieldId}-label`}
      className='space-y-2'
    >
      <Label id={`${fieldId}-label`} htmlFor={fieldId} className='break-words'>
        {label}
      </Label>
      <div className='flex gap-2'>
        <Input
          id={fieldId}
          readOnly
          value={formatNumber(BigInt(balance.available_points), locale)}
          className='min-w-0 flex-1 tabular-nums'
        />
        <Button
          type='button'
          variant='outline'
          disabled={props.disabled}
          onClick={() => setOpen(true)}
          className='shrink-0'
        >
          <Pencil className='mr-1 h-4 w-4' />
          {t('Adjust Points')}
        </Button>
      </div>
      {balance.frozen_points !== '0' && (
        <p className='text-muted-foreground text-sm'>
          {t('Frozen points')}:{' '}
          {formatNumber(BigInt(balance.frozen_points), locale)}
        </p>
      )}
      <UserPointsDialog
        open={props.open && open}
        onOpenChange={setOpen}
        userId={props.userId}
        pointTypeId={balance.point_type_id}
        onSuccess={props.onSuccess}
      />
    </div>
  )
}

export function UserPointsEditor(props: Props) {
  const { t } = useTranslation()
  const viewerId = useAuthStore((state) => state.auth.user?.id)
  const balances = useQuery({
    queryKey: ['admin-user-points', viewerId, props.userId],
    queryFn: () => getUserPoints(props.userId),
    enabled: props.open && !!viewerId,
    retry: false,
    meta: { errorToast: false },
  })
  if (balances.isPending) return <LoadingState />
  return (
    <>
      {balances.isError && (
        <ErrorState
          title={t('Failed to load points')}
          onRetry={() => void balances.refetch()}
        />
      )}
      {balances.isFetching && <LoadingState inline message={t('Loading...')} />}
      {!balances.isError && balances.data?.length === 0 && (
        <EmptyState title={t('No point types configured')} />
      )}
      {balances.data?.map((balance) => (
        <UserPointRow
          key={balance.point_type_id}
          {...props}
          balance={balance}
          disabled={balances.isError || balances.isFetching}
        />
      ))}
    </>
  )
}

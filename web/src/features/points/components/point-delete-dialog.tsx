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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { deletePointType } from '../api'
import type { PointType } from '../types'

export function PointDeleteDialog(props: {
  pointType: PointType
  onClose: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [original] = useState(props.pointType)
  const mutation = useMutation({
    mutationFn: () => deletePointType(original.id, original.config_version),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['points'] }),
        client.invalidateQueries({ queryKey: ['points-wallet'] }),
        client.invalidateQueries({ queryKey: ['admin-user-points'] }),
        client.invalidateQueries({ queryKey: ['point-ledger'] }),
        client.invalidateQueries({ queryKey: ['subscription-plans'] }),
        client.invalidateQueries({ queryKey: ['custom-subscriptions'] }),
        client.invalidateQueries({ queryKey: ['invitation'] }),
      ])
      toast.success(t('Point type deleted'))
      props.onClose()
    },
    onError: (error) => handleServerError(error),
  })
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      title={t('Delete point type')}
      desc={
        <div className='space-y-2'>
          <p className='font-medium break-words'>{original.name}</p>
          <p>
            {t(
              'Only unused point types can be deleted. Their eligibility rules will also be removed.'
            )}
          </p>
          <p>
            {t(
              'Accounts and historical orders, rewards or model billing snapshots count as usage, even when the current balance is zero.'
            )}
          </p>
        </div>
      }
      destructive
      confirmText={t('Delete point type')}
      isLoading={mutation.isPending}
      handleConfirm={() => mutation.mutate()}
    >
      {mutation.isError && (
        <p role='alert' className='text-destructive text-sm'>
          {t(getServerErrorMessage(mutation.error), {
            skipInterpolation: true,
          })}
        </p>
      )}
    </ConfirmDialog>
  )
}

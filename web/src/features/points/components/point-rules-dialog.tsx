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
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { getPointChannels, getPointPolicy, pointsQueryKeys } from '../api'
import type { PointType } from '../types'
import { PointPolicyEditor } from './point-policy-editor'

export function PointRulesDialog(props: {
  pointType: PointType
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const query = useQuery({
    queryKey: pointsQueryKeys.policy(props.pointType.id),
    queryFn: () => getPointPolicy(props.pointType.id),
  })
  const channels = useQuery({
    queryKey: ['points', 'channels'],
    queryFn: getPointChannels,
  })
  let content
  if (query.isPending || channels.isPending) content = <LoadingState />
  else if (query.isError || channels.isError) {
    content = (
      <ErrorState
        description={getServerErrorMessage(query.error ?? channels.error)}
        onRetry={() => {
          void query.refetch()
          void channels.refetch()
        }}
      />
    )
  } else {
    content = (
      <PointPolicyEditor
        typeId={props.pointType.id}
        config={query.data}
        channels={channels.data}
        onClose={props.onClose}
        onPendingChange={setPending}
      />
    )
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) props.onClose()
      }}
      title={t('Point rules for {{name}}', { name: props.pointType.name })}
      description={t(
        'Choose OR or AND between groups and within each group. Channel conditions use the channel actually selected for the request.'
      )}
      showCloseButton={!pending}
      contentClassName='sm:max-w-5xl'
    >
      {content}
    </Dialog>
  )
}

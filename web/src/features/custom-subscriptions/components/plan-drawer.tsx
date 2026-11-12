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
import { useTranslation } from 'react-i18next'

import {
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { getPlan, subscriptionKeys } from '../api'
import type { PointTypeOption } from '../types'
import { PlanDetails } from './plan-details'
import { PlanForm } from './plan-form'

export type PlanDrawerSelection =
  | { mode: 'create' }
  | { mode: 'edit' | 'details'; id: string }
export function PlanDrawer(props: {
  selection: PlanDrawerSelection
  viewer: string
  types?: PointTypeOption[]
  onClose: () => void
  onSaved: () => Promise<void>
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const id = props.selection.mode === 'create' ? '' : props.selection.id
  const query = useQuery({
    queryKey: subscriptionKeys.detail(props.viewer, id),
    queryFn: () => getPlan(id),
    enabled: !!id,
  })
  let title = t('Create plan')
  if (props.selection.mode === 'edit') title = t('Edit plan')
  if (props.selection.mode === 'details') title = t('Plan details')
  let content
  if (id && query.isPending) content = <LoadingState />
  else if (id && query.isError) {
    content = (
      <ErrorState
        description={getServerErrorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    )
  } else if (props.selection.mode === 'details' && query.data) {
    content = <PlanDetails plan={query.data} />
  } else {
    content = (
      <PlanForm
        key={id || 'create'}
        plan={query.data}
        types={props.types}
        onClose={props.onClose}
        onSaved={props.onSaved}
        onRetry={props.onRetry}
      />
    )
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[640px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {t('Manage point subscription configuration.')}
          </SheetDescription>
        </SheetHeader>
        {content}
        {props.selection.mode === 'details' && (
          <SheetFooter className={sideDrawerFooterClassName()}>
            <Button variant='outline' onClick={props.onClose}>
              {t('Close')}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}

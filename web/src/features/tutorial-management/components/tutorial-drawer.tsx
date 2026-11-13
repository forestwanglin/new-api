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
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { getTutorialGroup, getTutorialChapter, tutorialKeys } from '../api'
import type {
  TutorialEntity,
  TutorialSelection,
  TutorialGroup,
  TutorialChapter,
} from '../types'
import { TutorialForm } from './tutorial-form'

export function TutorialDrawer(props: {
  entity: TutorialEntity
  selection: TutorialSelection
  viewer: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const id = props.selection.mode === 'create' ? '' : props.selection.id
  const query = useQuery<TutorialGroup | TutorialChapter>({
    queryKey: tutorialKeys.detail(props.viewer, props.entity, id),
    queryFn: () =>
      props.entity === 'groups' ? getTutorialGroup(id) : getTutorialChapter(id),
    enabled: !!id,
  })
  const titles = {
    groups: {
      create: 'Create tutorial group',
      edit: 'Edit tutorial group',
      details: 'Tutorial group details',
    },
    chapters: {
      create: 'Create tutorial chapter',
      edit: 'Edit tutorial chapter',
      details: 'Tutorial chapter details',
    },
  }
  const title = titles[props.entity][props.selection.mode]
  let content
  if (id && query.isPending) content = <LoadingState />
  else if (id && query.isError) {
    content = (
      <ErrorState
        description={getServerErrorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    )
  } else {
    content = (
      <TutorialForm
        key={id || 'create'}
        viewer={props.viewer}
        entity={props.entity}
        item={query.data}
        readOnly={props.selection.mode === 'details'}
        onClose={props.onClose}
        onSaved={props.onSaved}
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
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[760px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>{t(title)}</SheetTitle>
          <SheetDescription>
            {t(
              'Manage the configuration tutorial directory and Markdown content.'
            )}
          </SheetDescription>
        </SheetHeader>
        {content}
      </SheetContent>
    </Sheet>
  )
}

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
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
} from '@/components/drawer-layout'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { getRule, ruleKeys } from './api'
import { RuleContentView } from './rule-content'
import { RuleForm } from './rule-form'

export type RuleSelection =
  | { mode: 'create' }
  | { mode: 'edit' | 'details'; id: string }
export function RuleDrawer(props: {
  selection: RuleSelection
  viewer: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const id = props.selection.mode === 'create' ? '' : props.selection.id
  const query = useQuery({
    queryKey: ruleKeys.detail(props.viewer, id),
    queryFn: () => getRule(id),
    enabled: !!id,
  })
  let title = t('Create rule')
  if (props.selection.mode === 'edit') title = t('Edit rule')
  if (props.selection.mode === 'details') title = t('Rule details')
  let content
  if (id && query.isPending) content = <LoadingState />
  else if (id && query.isError && !query.data) {
    content = (
      <ErrorState
        description={t(getServerErrorMessage(query.error))}
        onRetry={() => void query.refetch()}
      />
    )
  } else if (props.selection.mode === 'details' && query.data) {
    const rule = query.data
    const fields = [
      [t('Rule key'), rule.rule_key],
      [t('Applicable plan'), rule.plan?.title ?? t('Global rule')],
      [t('Status'), t(rule.enabled ? 'Enabled' : 'Disabled')],
      [t('Sort order'), formatNumber(rule.sort_order, locale)],
      [t('Version'), rule.version],
      [t('Updated at'), new Date(rule.updated_at).toLocaleString(locale)],
    ]
    content = (
      <div className={sideDrawerFormClassName()}>
        <dl className='grid min-w-0 gap-4 sm:grid-cols-2'>
          {fields.map(([label, value]) => (
            <div key={label} className='min-w-0'>
              <dt className='text-muted-foreground text-sm'>{label}</dt>
              <dd className='[overflow-wrap:anywhere]'>{value}</dd>
            </div>
          ))}
        </dl>
        <h3 className='font-medium [overflow-wrap:anywhere]'>{rule.title}</h3>
        <RuleContentView content={rule.content} />
      </div>
    )
  } else {
    content = (
      <RuleForm
        viewer={props.viewer}
        rule={query.data}
        onClose={props.onClose}
        onSaved={props.onSaved}
        refreshError={
          query.isError ? t(getServerErrorMessage(query.error)) : undefined
        }
        onRetry={() => void query.refetch()}
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
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[720px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {t('Manage subscription rule content and presentation.')}
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

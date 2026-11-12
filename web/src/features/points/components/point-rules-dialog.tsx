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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { StaticDataTable, StaticRowActions } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { deletePointRule, getPointRules, pointsQueryKeys } from '../api'
import type { PointModelRule, PointType } from '../types'
import { PointRuleForm } from './point-rule-form'

type Props = { pointType: PointType; onClose: () => void }

export function PointRulesDialog(props: Props) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [formRule, setFormRule] = useState<PointModelRule | null | undefined>(
    undefined
  )
  const [deleteRule, setDeleteRule] = useState<PointModelRule | null>(null)
  const query = useQuery({
    queryKey: pointsQueryKeys.rules(props.pointType.id),
    queryFn: () => getPointRules(props.pointType.id),
  })
  const deletion = useMutation({
    mutationFn: (ruleId: number) => deletePointRule(props.pointType.id, ruleId),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: pointsQueryKeys.rules(props.pointType.id),
      })
      toast.success(t('Model rule deleted'))
      setDeleteRule(null)
    },
  })
  let content
  if (query.isPending) content = <LoadingState />
  else if (query.isError) {
    content = (
      <ErrorState
        description={getServerErrorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    )
  } else {
    content = (
      <StaticDataTable
        tableClassName='min-w-[480px]'
        data={query.data}
        getRowKey={(rule) => rule.id}
        emptyContent={
          <EmptyState
            title={t('No model rules configured')}
            description={t(
              'Without an enabled rule, this point type cannot be used for any model.'
            )}
          />
        }
        columns={[
          {
            id: 'mode',
            header: t('Match mode'),
            cell: (rule) => rule.match_type,
          },
          {
            id: 'value',
            header: t('Model name or pattern'),
            cell: (rule) => (
              <span className='font-mono'>{rule.match_value}</span>
            ),
          },
          {
            id: 'enabled',
            header: t('Status'),
            cell: (rule) => (
              <StatusBadge
                label={rule.enabled ? t('Enabled') : t('Disabled')}
                variant={rule.enabled ? 'success' : 'neutral'}
                copyable={false}
              />
            ),
          },
          {
            id: 'actions',
            header: t('Actions'),
            className: 'text-right',
            cell: (rule) => (
              <StaticRowActions
                editLabel={t('Edit model rule')}
                deleteLabel={t('Delete model rule')}
                menuLabel={t('Open menu')}
                onEdit={() => setFormRule(rule)}
                onDelete={() => setDeleteRule(rule)}
              />
            ),
          },
        ]}
      />
    )
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) props.onClose()
        }}
        title={t('Model rules for {{code}}', { code: props.pointType.code })}
        description={t(
          'Enabled rules are combined with OR. Model names do not need to exist in the model catalog.'
        )}
        contentClassName='sm:max-w-3xl'
      >
        <div className='mb-4 flex flex-wrap gap-2'>
          <Button size='sm' onClick={() => setFormRule(null)}>
            {t('Add model rule')}
          </Button>
          <Button
            size='sm'
            variant='outline'
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t('Refresh')}
          </Button>
        </div>
        {content}
      </Dialog>
      {formRule !== undefined && (
        <PointRuleForm
          key={formRule?.id ?? 'new'}
          typeId={props.pointType.id}
          rule={formRule}
          onClose={() => setFormRule(undefined)}
        />
      )}
      <ConfirmDialog
        open={deleteRule !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteRule(null)
        }}
        title={t('Delete model rule')}
        desc={t('Delete model rule "{{value}}"?', {
          value: deleteRule?.match_value ?? '',
        })}
        destructive
        confirmText={t('Delete')}
        isLoading={deletion.isPending}
        handleConfirm={() => {
          if (deleteRule) deletion.mutate(deleteRule.id)
        }}
      />
    </>
  )
}

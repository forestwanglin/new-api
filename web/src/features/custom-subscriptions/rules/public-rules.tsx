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

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { getPublicRules, ruleKeys } from './api'
import { RuleContentView } from './rule-content'

export function PublicSubscriptionRules() {
  const { t } = useTranslation()
  const query = useQuery({ queryKey: ruleKeys.public, queryFn: getPublicRules })
  if (query.isPending) return <LoadingState />
  if (query.isError) {
    return (
      <ErrorState
        description={t(getServerErrorMessage(query.error))}
        onRetry={() => void query.refetch()}
      />
    )
  }
  if (!query.data.length) {
    return <EmptyState title={t('No subscription rules')} />
  }
  return (
    <ol className='sub-rules'>
      {query.data.map((rule) => (
        <li key={rule.id}>
          <strong>{rule.title}</strong>
          <RuleContentView content={rule.content} />
        </li>
      ))}
    </ol>
  )
}

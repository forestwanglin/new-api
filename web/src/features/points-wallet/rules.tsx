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
import { RuleContentView } from '@/features/custom-subscriptions/rules/rule-content'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { getPointsWalletRules } from './api'

export function PointsWalletRules() {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const query = useQuery({
    queryKey: ['points-wallet-rules', userId],
    queryFn: getPointsWalletRules,
    enabled: !!userId,
  })
  return (
    <section className='account-card wallet-rules'>
      <h2>{t('Points rules')}</h2>
      <p>{t('Rules below follow the current database configuration.')}</p>
      {query.isPending && <LoadingState />}
      {query.isError && (
        <ErrorState
          description={getServerErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.isSuccess && !query.data.length && (
        <EmptyState title={t('No points rules configured')} />
      )}
      {query.data && query.data.length > 0 && (
        <details>
          <summary>
            {t('View full points rules ({{count}})', {
              count: query.data.length,
            })}
          </summary>
          <ol className='wallet-rule-list'>
            {query.data.map((rule) => (
              <li key={rule.id}>
                <strong>{rule.title}</strong>
                <RuleContentView content={rule.content} />
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  )
}

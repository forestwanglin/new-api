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
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/features/pricing/components/empty-state'
import { ModelBillingModeBadge } from '@/features/pricing/components/model-billing-mode-badge'
import { ModelPriceCell } from '@/features/pricing/components/model-price-cell'
import { SearchBar } from '@/features/pricing/components/search-bar'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import { filterBySearch } from '@/features/pricing/lib/filters'
import { SubscriptionsCustomFooter } from '@/features/subscriptions-custom/footer'
import { SupportDialog } from '@/features/subscriptions-custom/support-dialog'
import { toIntlLocale } from '@/i18n/languages'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'

import {
  getModelCategory,
  getModelVendorKey,
  type ModelCategory,
} from './categories'
import {
  ModelSidebar,
  type ModelCategoryGroup,
  type ModelFilter,
} from './model-sidebar'

import '@/styles/model-plaza.css'

export function ModelPlaza() {
  const { t, i18n } = useTranslation()
  const isAuthenticated = useAuthStore((state) => !!state.auth.user)
  const { models, isLoading, error, refetch, priceRate, usdExchangeRate } =
    usePricingData(true, 'model')
  const [keyword, setKeyword] = useState('')
  const [filter, setFilter] = useState<ModelFilter>({
    category: null,
    vendorId: null,
  })
  const [supportOpen, setSupportOpen] = useState(false)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  const searchedModels = useMemo(
    () => filterBySearch(models, keyword.trim()),
    [models, keyword]
  )
  const categoryLabels: Record<ModelCategory, string> = {
    domestic: t('Domestic Models'),
    overseas: t('Overseas Models'),
    other: t('Other Models'),
  }
  const categories = useMemo(() => {
    const groups = new Map<ModelCategory, ModelCategoryGroup>()
    const matches = new Set(searchedModels)
    // Keep categories present in the full response visible even for zero search matches.
    for (const model of models) {
      const category = getModelCategory(model)
      const group = groups.get(category) ?? {
        id: category,
        label: '',
        count: 0,
        vendors: [],
      }
      const matched = matches.has(model) ? 1 : 0
      group.count += matched
      const id = getModelVendorKey(model)
      const vendor = group.vendors.find((entry) => entry.id === id)
      if (vendor) {
        vendor.count += matched
      } else {
        group.vendors.push({
          id,
          name: model.vendor_name ?? '',
          count: matched,
        })
      }
      groups.set(category, group)
    }
    return (['domestic', 'overseas', 'other'] as const).flatMap((category) => {
      const group = groups.get(category)
      if (!group) return []
      group.vendors.sort((a, b) => a.name.localeCompare(b.name, locale))
      return [group]
    })
  }, [models, searchedModels, locale])
  const activeCategory = categories.find(
    (category) => category.id === filter.category
  )
  const activeVendor = activeCategory?.vendors.find(
    (vendor) => vendor.id === filter.vendorId
  )
  const scopeLabel =
    activeVendor?.name ??
    (filter.category ? categoryLabels[filter.category] : t('All Models'))
  const filteredModels = useMemo(() => {
    const filtered = searchedModels.filter((model) => {
      if (filter.category && getModelCategory(model) !== filter.category) {
        return false
      }
      return (
        filter.vendorId === null || getModelVendorKey(model) === filter.vendorId
      )
    })
    return [...filtered].sort((a, b) =>
      a.model_name.localeCompare(b.model_name, locale)
    )
  }, [searchedModels, filter, locale])

  return (
    <PublicLayout showMainContainer={false}>
      <main className='pt-16'>
        <div className='model-plaza'>
          <header className='mp-head'>
            <h1>{t('Models')}</h1>
            <p>{t('Browse available models and pricing')}</p>
          </header>

          <SearchBar
            value={keyword}
            onChange={setKeyword}
            onClear={() => setKeyword('')}
            className='mt-6 max-w-md'
          />

          <div className='mp-plaza'>
            <ModelSidebar
              groups={categories.map((group) => ({
                ...group,
                label: categoryLabels[group.id],
              }))}
              count={searchedModels.length}
              filter={filter}
              onChange={setFilter}
            />

            <section
              className='mp-main'
              aria-labelledby='mp-scope'
              aria-busy={isLoading}
            >
              <div className='mp-main-head'>
                <h2 id='mp-scope'>{scopeLabel}</h2>
                {!isLoading && !error && (
                  <span className='mp-count'>
                    {t('{{count}} models', { count: filteredModels.length })}
                  </span>
                )}
              </div>

              {isLoading && <LoadingState />}
              {error && (
                <ErrorState
                  title={t('Failed to load model pricing')}
                  description={getServerErrorMessage(error)}
                  onRetry={() => void refetch()}
                />
              )}
              {!isLoading && !error && filteredModels.length === 0 && (
                <EmptyState
                  searchQuery={keyword}
                  hasActiveFilters={filter.category !== null}
                  onClearFilters={() => {
                    setKeyword('')
                    setFilter({ category: null, vendorId: null })
                  }}
                />
              )}
              {!isLoading && !error && filteredModels.length > 0 && (
                <>
                  <table className='mp-table'>
                    <thead>
                      <tr>
                        <th scope='col'>{t('Model Name')}</th>
                        <th scope='col'>{t('Description')}</th>
                        <th scope='col'>{t('Type')}</th>
                        <th scope='col'>{t('Price')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredModels.map((model) => (
                        <tr key={model.model_name}>
                          <td data-label={t('Model Name')}>
                            <div className='mp-name'>{model.model_name}</div>
                            <Button
                              size='sm'
                              variant='outline'
                              render={
                                isAuthenticated ? (
                                  <Link to='/keys' />
                                ) : undefined
                              }
                              onClick={() => {
                                if (!isAuthenticated) {
                                  useLoginModalStore
                                    .getState()
                                    .open({ redirectTo: '/keys' })
                                }
                              }}
                            >
                              {t('Use model')}
                            </Button>
                          </td>
                          <td data-label={t('Description')} className='mp-use'>
                            {model.description ||
                              t('No description available.')}
                          </td>
                          <td data-label={t('Type')}>
                            <ModelBillingModeBadge model={model} />
                          </td>
                          <td data-label={t('Price')}>
                            <ModelPriceCell
                              model={model}
                              options={{
                                tokenUnit: 'M',
                                priceRate,
                                usdExchangeRate,
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className='mp-note'>
                    {t(
                      'Prices use the lowest available group rate. Actual charges depend on usage.'
                    )}
                  </p>
                </>
              )}
            </section>
          </div>
        </div>
      </main>
      <SupportDialog open={supportOpen} onOpenChange={setSupportOpen} />
      <SubscriptionsCustomFooter onContact={() => setSupportOpen(true)} />
    </PublicLayout>
  )
}

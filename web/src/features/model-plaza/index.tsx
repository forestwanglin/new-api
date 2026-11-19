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
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { getPerfMetricsSummary } from '@/features/performance-metrics/api'
import { EmptyState } from '@/features/pricing/components/empty-state'
import { ModelBillingModeBadge } from '@/features/pricing/components/model-billing-mode-badge'
import { ModelPriceCell } from '@/features/pricing/components/model-price-cell'
import { SearchBar } from '@/features/pricing/components/search-bar'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import { filterBySearch } from '@/features/pricing/lib/filters'
import { SubscriptionsCustomFooter } from '@/features/subscriptions-custom/footer'
import { SupportDialog } from '@/features/subscriptions-custom/support-dialog'
import { normalizeInterfaceLanguage, toIntlLocale } from '@/i18n/languages'
import {
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'
import {
  DEFAULT_MODEL_REFERENCE_EXCHANGE_RATE,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import {
  getModelCategory,
  getModelVendorKey,
  type ModelCategory,
} from './categories'
import { ModelStatusCell } from './components/model-status-cell'
import {
  formatModelDiscount,
  getModelDiscountRatio,
  getReferencePriceMultiplier,
} from './display-discount'
import {
  ModelSidebar,
  type ModelCategoryGroup,
  type ModelFilter,
} from './model-sidebar'

import '@/styles/model-plaza.css'

export function ModelPlaza() {
  const { t, i18n } = useTranslation()
  const language = normalizeInterfaceLanguage(
    i18n.resolvedLanguage || i18n.language
  )
  const isChinese = language === 'zhCN' || language === 'zhTW'
  const referenceExchangeRate = useSystemConfigStore(
    (state) =>
      state.config.modelReferenceExchangeRate ??
      DEFAULT_MODEL_REFERENCE_EXCHANGE_RATE
  )
  const isAuthenticated = useAuthStore((state) => !!state.auth.user)
  const {
    models: pricingModels,
    vendors,
    isLoading,
    error,
    refetch,
    priceRate,
    usdExchangeRate,
  } = usePricingData(true, 'model')
  const models = useMemo(() => {
    const openAI = vendors.find(
      (vendor) => vendor.name.trim().toLowerCase() === 'openai'
    )
    const byteDance = vendors.find((vendor) =>
      [
        '字节跳动',
        '字节系列',
        'bytedance',
        'doubao',
        '豆包',
        '火山引擎',
      ].includes(vendor.name.trim().toLowerCase())
    )
    // The review endpoint is an OpenAI model even when its API metadata is absent or stale.
    return pricingModels.map((model) => {
      if (model.model_name === 'codex-auto-review') {
        return {
          ...model,
          vendor_id: openAI?.id,
          vendor_name: 'OpenAI',
          vendor_icon: openAI?.icon,
        }
      }
      if (/^(?:sd2\.0-|seedance-|doubao-seedance-)/i.test(model.model_name)) {
        return {
          ...model,
          vendor_id: byteDance?.id,
          vendor_name: '字节跳动',
          vendor_icon: byteDance?.icon,
        }
      }
      return model
    })
  }, [pricingModels, vendors])
  // One public summary covers every model with traffic, so filtering and
  // searching never trigger per-row performance requests.
  const perfQuery = useQuery({
    queryKey: ['perf-metrics-summary', 24],
    queryFn: async () => requireServerSuccess(await getPerfMetricsSummary(24)),
    enabled: models.length > 0,
    staleTime: 60 * 1000,
    retry: false,
    meta: { errorToast: false },
  })
  const perfMap = useMemo(
    () =>
      new Map(
        (perfQuery.data?.data.models ?? []).map((model) => [
          model.model_name,
          model,
        ])
      ),
    [perfQuery.data]
  )

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

  const modelSections = [
    {
      id: 'text',
      title: `${scopeLabel} · ${t('Text Models')}`,
      models: filteredModels.filter(
        (model) => !model.supported_endpoint_types?.includes('openai-video')
      ),
    },
    {
      id: 'video',
      title: `${scopeLabel} · ${t('Video Models')}`,
      models: filteredModels.filter((model) =>
        model.supported_endpoint_types?.includes('openai-video')
      ),
    },
  ].filter((section) => section.models.length > 0)

  const discounts = models
    .map((model) => getModelDiscountRatio(model, referenceExchangeRate))
    .filter((ratio): ratio is number => ratio !== null && ratio < 1)
  const bestDiscount = discounts.length ? Math.min(...discounts) : null

  return (
    <PublicLayout
      showMainContainer={false}
      headerProps={{ activeNavHref: '/model' }}
    >
      <main className='pt-16'>
        <div className='model-plaza'>
          <header className='mp-head'>
            <h1>{t('Models')}</h1>
            <p>
              {t(
                'Access leading domestic and international models in one place · Choose text chat or video generation on demand'
              )}
            </p>
          </header>

          {!isLoading && !error && bestDiscount !== null && (
            <div
              className='mp-deal'
              role='status'
              aria-label={t('Model discount')}
            >
              <span>{t('Models from')}</span>
              <strong>
                {isChinese
                  ? t('{{discount}} tenths of reference price', {
                      discount: formatModelDiscount(bestDiscount),
                    })
                  : t('modelPlaza.percentOff', {
                      defaultValue: '{{percent}}% OFF',
                      percent: Math.round((1 - bestDiscount) * 100),
                    })}
              </strong>
              <span>{t('Compared with the official website')}</span>
              {isChinese && (
                <b>
                  {t('Save up to {{percent}}%', {
                    percent: Math.round((1 - bestDiscount) * 100),
                  })}
                </b>
              )}
            </div>
          )}

          <p className='mp-note'>
            {t(
              'Compare model configurations using fixed token usage. Platform usage counts follow the same point deduction rules.'
            )}
          </p>

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
              aria-label={scopeLabel}
              aria-busy={isLoading}
            >
              {(isLoading || error || filteredModels.length === 0) && (
                <div className='mp-main-head'>
                  <h2 id='mp-scope'>{scopeLabel}</h2>
                  {!isLoading && !error && (
                    <span className='mp-count'>
                      {t('{{count}} models', { count: filteredModels.length })}
                    </span>
                  )}
                </div>
              )}

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
                  {modelSections.map((section) => (
                    <section
                      key={section.id}
                      className='mb-8'
                      aria-labelledby={`mp-${section.id}-title`}
                    >
                      <div className='mp-main-head'>
                        <h2 id={`mp-${section.id}-title`}>{section.title}</h2>
                        <span className='mp-count'>
                          {t('{{count}} models', {
                            count: section.models.length,
                          })}
                        </span>
                      </div>
                      <table
                        className='mp-table'
                        aria-labelledby={`mp-${section.id}-title`}
                      >
                        <thead>
                          <tr>
                            <th scope='col'>{t('Model Name')}</th>
                            <th scope='col'>{t('Description')}</th>
                            <th scope='col'>{t('Type')}</th>
                            <th scope='col'>{t('Status')}</th>
                            <th scope='col'>{t('Price')}</th>
                            <th scope='col' className='is-right'>
                              {t('Discount ratio')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.models.map((model) => (
                            <tr key={model.model_name}>
                              <td data-label={t('Model Name')}>
                                <div className='mp-name'>
                                  {model.model_name}
                                </div>
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
                              <td
                                data-label={t('Description')}
                                className='mp-use'
                              >
                                {model.description ||
                                  t('No description available.')}
                              </td>
                              <td data-label={t('Type')}>
                                <ModelBillingModeBadge model={model} />
                              </td>
                              <td data-label={t('Status')}>
                                <ModelStatusCell
                                  perf={perfMap.get(model.model_name)}
                                />
                              </td>
                              <td data-label={t('Price')}>
                                <ModelPriceCell
                                  model={model}
                                  options={{
                                    tokenUnit: 'M',
                                    priceRate,
                                    usdExchangeRate,
                                    originalPriceMultiplier:
                                      getReferencePriceMultiplier(
                                        model,
                                        referenceExchangeRate
                                      ),
                                  }}
                                />
                              </td>
                              <td
                                data-label={t('Discount ratio')}
                                className='is-right'
                              >
                                <ModelDiscount
                                  model={model}
                                  referenceExchangeRate={referenceExchangeRate}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  ))}
                  <p className='mp-note'>
                    {t(
                      'Prices use the lowest available group rate. Actual charges depend on usage.'
                    )}
                  </p>
                  <p className='mp-note'>
                    {t(
                      'Overseas reference prices used for discount comparisons are converted at a reference rate of USD 1 = CNY {{rate}}. This rate is for display only and does not change billing.',
                      { rate: String(referenceExchangeRate) }
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

function ModelDiscount(props: {
  model: Parameters<typeof getModelDiscountRatio>[0]
  referenceExchangeRate: number
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeInterfaceLanguage(
    i18n.resolvedLanguage || i18n.language
  )
  const isChinese = language === 'zhCN' || language === 'zhTW'
  const ratio = getModelDiscountRatio(props.model, props.referenceExchangeRate)
  if (ratio === null) return <span className='mp-unavailable'>—</span>
  return (
    <>
      <span className='mp-discount'>
        {isChinese
          ? t('{{discount}} tenths of reference price', {
              discount: formatModelDiscount(ratio),
            })
          : t('modelPlaza.percentOff', {
              defaultValue: '{{percent}}% OFF',
              percent: Math.round((1 - ratio) * 100),
            })}
      </span>
      {ratio < 1 && (
        <span className='mp-saving'>
          {t('Save {{percent}}% compared with the official website', {
            percent: Math.round((1 - ratio) * 100),
          })}
        </span>
      )}
    </>
  )
}

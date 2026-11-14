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

import '@/styles/model-plaza.css'

export function ModelPlaza() {
  const { t, i18n } = useTranslation()
  const isAuthenticated = useAuthStore((state) => !!state.auth.user)
  const { models, isLoading, error, refetch, priceRate, usdExchangeRate } =
    usePricingData(true, 'model')
  const [keyword, setKeyword] = useState('')
  const [vendorFilter, setVendorFilter] = useState<string | null>(null)
  const [supportOpen, setSupportOpen] = useState(false)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  const vendors = useMemo(() => {
    const counts = new Map<
      string,
      { id: string; name: string; count: number }
    >()
    for (const model of models) {
      const id = model.vendor_name ? String(model.vendor_id) : 'unknown'
      const vendor = counts.get(id) ?? {
        id,
        name: model.vendor_name ?? t('Unknown'),
        count: 0,
      }
      vendor.count++
      counts.set(id, vendor)
    }
    return [...counts.values()].sort((a, b) =>
      a.name.localeCompare(b.name, locale)
    )
  }, [models, locale, t])
  const activeVendor = vendors.find((vendor) => vendor.id === vendorFilter)
  const filteredModels = useMemo(() => {
    const searched = filterBySearch(models, keyword.trim())
    const filtered = activeVendor
      ? searched.filter(
          (model) =>
            (model.vendor_name ? String(model.vendor_id) : 'unknown') ===
            activeVendor.id
        )
      : searched
    return [...filtered].sort((a, b) =>
      a.model_name.localeCompare(b.model_name, locale)
    )
  }, [models, keyword, activeVendor, locale])

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
            <aside className='mp-side' aria-label={t('Vendors')}>
              <div className='mp-group'>
                <div className='mp-group-head'>{t('Vendors')}</div>
                <div className='mp-items'>
                  <Button
                    type='button'
                    variant='ghost'
                    className={`mp-item${!activeVendor ? ' is-active' : ''}`}
                    aria-pressed={!activeVendor}
                    onClick={() => setVendorFilter(null)}
                  >
                    <span className='mp-dot' aria-hidden='true' />
                    <span className='mp-item-name'>{t('All Models')}</span>
                    <span className='mp-item-count'>{models.length}</span>
                  </Button>
                  {vendors.map((vendor) => (
                    <Button
                      key={vendor.id}
                      type='button'
                      variant='ghost'
                      className={`mp-item${activeVendor?.id === vendor.id ? ' is-active' : ''}`}
                      aria-pressed={activeVendor?.id === vendor.id}
                      onClick={() => setVendorFilter(vendor.id)}
                    >
                      <span className='mp-dot' aria-hidden='true' />
                      <span className='mp-item-name'>{vendor.name}</span>
                      <span className='mp-item-count'>{vendor.count}</span>
                    </Button>
                  ))}
                </div>
              </div>
            </aside>

            <section
              className='mp-main'
              aria-labelledby='mp-scope'
              aria-busy={isLoading}
            >
              <div className='mp-main-head'>
                <h2 id='mp-scope'>{activeVendor?.name ?? t('All Models')}</h2>
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
                  hasActiveFilters={!!activeVendor}
                  onClearFilters={() => {
                    setKeyword('')
                    setVendorFilter(null)
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

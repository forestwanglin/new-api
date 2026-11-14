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
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import type { ModelCategory } from './categories'

export type ModelCategoryGroup = {
  id: ModelCategory
  label: string
  count: number
  vendors: { id: string; name: string; count: number }[]
}

export type ModelFilter = {
  category: ModelCategory | null
  vendorId: string | null
}

interface ModelSidebarProps {
  groups: ModelCategoryGroup[]
  count: number
  filter: ModelFilter
  onChange: (filter: ModelFilter) => void
}

export function ModelSidebar(props: ModelSidebarProps) {
  const { t } = useTranslation()
  const allSelected = props.filter.category === null

  return (
    <aside className='mp-side' aria-label={t('Vendors')}>
      <div className='mp-group'>
        <Button
          type='button'
          variant='ghost'
          className={`mp-item${allSelected ? ' is-active' : ''}`}
          aria-pressed={allSelected}
          onClick={() => props.onChange({ category: null, vendorId: null })}
        >
          <span className='mp-dot' aria-hidden='true' />
          <span className='mp-item-name'>{t('All Models')}</span>
          <span className='mp-item-count'>{props.count}</span>
        </Button>
      </div>
      {props.groups.map((group) => {
        const selected =
          props.filter.category === group.id && props.filter.vendorId === null
        return (
          <div className='mp-group' key={group.id}>
            <Button
              type='button'
              variant='ghost'
              className={`mp-item mp-category${selected ? ' is-active' : ''}`}
              aria-pressed={selected}
              onClick={() =>
                props.onChange({ category: group.id, vendorId: null })
              }
            >
              <span className='mp-dot' aria-hidden='true' />
              <span className='mp-item-name'>{group.label}</span>
              <span className='mp-item-count'>{group.count}</span>
            </Button>
            {group.id !== 'other' && (
              <div className='mp-items mp-vendors'>
                {group.vendors.map((vendor) => {
                  const vendorSelected =
                    props.filter.category === group.id &&
                    props.filter.vendorId === vendor.id
                  return (
                    <Button
                      key={vendor.id}
                      type='button'
                      variant='ghost'
                      className={`mp-item${vendorSelected ? ' is-active' : ''}`}
                      aria-pressed={vendorSelected}
                      onClick={() =>
                        props.onChange({
                          category: group.id,
                          vendorId: vendor.id,
                        })
                      }
                    >
                      <span className='mp-dot' aria-hidden='true' />
                      <span className='mp-item-name'>{vendor.name}</span>
                      <span className='mp-item-count'>{vendor.count}</span>
                    </Button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </aside>
  )
}

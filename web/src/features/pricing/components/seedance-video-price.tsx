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

import {
  formatVideoCNY,
  getSeedanceVideoPrice,
  getSeedanceVideoSpec,
} from '../lib/video-price'
import type { PricingModel } from '../types'

export function SeedanceVideoPrice(props: {
  model: PricingModel
  selectedGroup?: string
}) {
  const { t } = useTranslation()
  const spec = getSeedanceVideoSpec(props.model)
  const price = getSeedanceVideoPrice(props.model, props.selectedGroup)
  if (!spec || !price) return null

  return (
    <section
      className='mt-4 overflow-hidden rounded-2xl border border-amber-300/70 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/20'
      aria-label={t('Video specification pricing')}
    >
      <div className='flex flex-wrap items-start justify-between gap-2 px-3 py-3'>
        <div>
          <h4 className='text-sm font-semibold'>
            {t('Video specification pricing')}
          </h4>
          <p className='text-muted-foreground mt-1 text-[11px]'>
            {t('CNY per second · No reference video')}
          </p>
        </div>
        <span className='rounded-full border border-amber-300/80 bg-amber-100/60 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200'>
          {t('Group rate {{rate}}%', {
            rate: Number((price.ratio * 100).toFixed(2)),
          })}
        </span>
      </div>
      <table className='w-full table-fixed border-collapse text-center text-xs'>
        <thead className='text-muted-foreground'>
          <tr className='border-y border-amber-300/60 dark:border-amber-800'>
            <th scope='col' className='w-[24%] px-1 py-2 font-medium'>
              {t('Resolution')}
            </th>
            <th
              scope='col'
              className='border-x border-amber-300/60 px-2 py-2 font-medium dark:border-amber-800'
            >
              {t('Official example rate')}
            </th>
            <th scope='col' className='px-2 py-2 font-medium'>
              {t('Site selling rate')}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope='row' className='px-2 py-3 text-left font-semibold'>
              {spec.resolution}
            </th>
            <td className='border-x border-amber-300/60 px-2 py-3 font-mono dark:border-amber-800'>
              {formatVideoCNY(price.base)}
            </td>
            <td className='px-2 py-3 font-mono font-bold text-amber-900 dark:text-amber-200'>
              {formatVideoCNY(price.sale)}
            </td>
          </tr>
        </tbody>
      </table>
      <div className='flex flex-wrap justify-between gap-2 border-t border-amber-300/60 px-3 py-2 text-xs dark:border-amber-800'>
        <span className='text-muted-foreground'>{t('5-second video')}</span>
        <span className='font-mono font-semibold'>
          {formatVideoCNY(price.sale * 5)}
        </span>
      </div>
      <p className='text-muted-foreground border-t border-amber-300/60 px-3 py-2 text-[11px] leading-relaxed dark:border-amber-800'>
        {t(
          'Official 16:9 example converted to seconds. Reference video input is unavailable.'
        )}
      </p>
    </section>
  )
}

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
import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import {
  getSeedanceVideoSpec,
  getSeedanceVideoPrice,
} from '../../lib/video-price'
import type { PricingModel } from '../../types'
import { SeedanceVideoPrice } from '../seedance-video-price'

const model = {
  id: 1,
  model_name: 'sd2.0-720P',
  quota_type: 1,
  model_ratio: 0,
  completion_ratio: 0,
  model_price: 0.994,
  enable_groups: ['seedance'],
  group_ratio: { seedance: 0.8 },
} as unknown as PricingModel

describe('Seedance pricing presentation', () => {
  test('720p sale price follows the configured group ratio exactly once', () => {
    expect(getSeedanceVideoPrice(model)?.sale).toBeCloseTo(0.7952, 8)
    expect(
      getSeedanceVideoPrice({ ...model, group_ratio: { seedance: 0.5 } })?.sale
    ).toBeCloseTo(0.497, 8)
  })

  test('card displays CNY per second and a five-second total instead of request or token units', () => {
    const { container } = render(<SeedanceVideoPrice model={model} />)
    const html = container.innerHTML
    expect(html).toContain('¥0.7952')
    expect(html).toContain('¥3.976')
    expect(html).toContain('CNY per second')
    expect(html).toContain('<table')
    expect(html).not.toContain('/ request')
    expect(html).not.toContain('/1M')
  })

  test('2.5 model displays only its currently available 720p specification', () => {
    const { container } = render(
      <SeedanceVideoPrice
        model={{ ...model, model_name: 'seedance-2.5', model_price: 1.512 }}
      />
    )
    expect(container.innerHTML).toContain('720p')
    expect(container.innerHTML).toContain('¥1.2096')
    expect(container.innerHTML).not.toContain('1080p')
  })

  test('unrelated models and missing or invalid prices do not show a video table', () => {
    expect(
      getSeedanceVideoSpec({ ...model, model_name: 'gpt-4' })
    ).toBeUndefined()
    for (const value of [undefined, -1, Number.NaN]) {
      const { container } = render(
        <SeedanceVideoPrice model={{ ...model, model_price: value }} />
      )
      expect(container.innerHTML).toBe('')
    }
  })
})

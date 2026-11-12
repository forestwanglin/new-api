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
import { describe, expect, it } from 'vitest'

import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import vi from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'
import { STATIC_I18N_KEYS } from '@/i18n/static-keys'

const keys = [
  'Custom Subscriptions',
  'Create plan',
  'Plan code',
  'Plan name',
  'Tier code',
  'Tier rank',
  'Price (CNY yuan)',
  'Paid points',
  'Paid point type',
  'Regular bonus points',
  'Regular bonus point type',
  'Automatic renewal',
  'Sort order',
  'Benefits',
  'Subtitle',
  'Yearly',
  'Created at',
  'Updated at',
  'Configuration only; automatic charging is not connected.',
  'Point type catalog unavailable. Retry before saving.',
  'Invalid custom subscription plan fields',
  'Invalid custom subscription plan filters',
  'Failed to manage custom subscription plans',
  'Custom subscription plan not found',
  'Custom subscription plan code already exists',
  'Custom subscription plan version conflict',
  'Plan has orders; disable it instead',
  'point type not found',
]

describe('custom subscription translations', () => {
  it.each(Object.entries({ en, fr, ja, ru, vi, zh, zhTW }))(
    'provides actual interface and backend error translations for %s',
    (locale, resource) => {
      const dictionary = resource.translation as Record<string, string>
      for (const key of keys) {
        expect(dictionary[key], `${locale}: ${key}`).toBeTruthy()
        expect(STATIC_I18N_KEYS).toContain(key)
        if (locale !== 'en') {
          expect(dictionary[key], `${locale}: ${key}`).not.toBe(key)
        }
      }
    }
  )
})

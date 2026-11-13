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
import i18next from 'i18next'
import { expect, it } from 'vitest'

import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import vi from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'

it('resolves the Chinese tutorial menu through the real i18next resource namespace', async () => {
  const i18n = i18next.createInstance()
  await i18n.init({
    lng: 'zh',
    fallbackLng: 'en',
    resources: { en, zh, 'zh-TW': zhTW, fr, ru, ja, vi },
  })
  expect(i18n.getFixedT('zh')('Configuration tutorial')).toBe('配置教程')
  expect(i18n.getFixedT('zh')('Tutorial management')).toBe('教程管理')
  for (const language of ['zh', 'zh-TW', 'fr', 'ru', 'ja', 'vi']) {
    expect(i18n.getFixedT(language)('Copy code')).not.toBe('Copy code')
    expect(
      i18n.getFixedT(language)('Tutorial was modified; reload before saving')
    ).not.toBe('Tutorial was modified; reload before saving')
  }
})

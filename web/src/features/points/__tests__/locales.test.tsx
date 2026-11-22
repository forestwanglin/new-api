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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import viLocale from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { Points } from '..'

it('updates the type title and CRUD action across all seven languages while preserving operator names', async () => {
  const translations = createInstance()
  await translations.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en, zh, 'zh-TW': zhTW, fr, ru, ja, vi: viLocale },
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: [
        {
          id: 3,
          code: 'IMAGE',
          name: 'Cancel',
          config_version: 1,
          consume_priority: 0,
          created_at: 0,
          updated_at: 0,
        },
      ],
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <I18nextProvider i18n={translations}>
      <QueryClientProvider client={client}>
        <Points />
      </QueryClientProvider>
    </I18nextProvider>
  )
  expect(await screen.findByText('Cancel')).toBeVisible()
  const languages = [
    ['en', 'Point types', 'Add point type'],
    ['zh', '积分类型', '新增积分类型'],
    ['zh-TW', '積分類型', '新增積分類型'],
    ['fr', 'Types de points', 'Ajouter un type de points'],
    ['ru', 'Типы баллов', 'Добавить тип баллов'],
    ['ja', 'ポイント種別', 'ポイント種別を追加'],
    ['vi', 'Loại điểm', 'Thêm loại điểm'],
  ]
  for (const [language, title, action] of languages) {
    await act(() => translations.changeLanguage(language))
    expect(screen.getByRole('heading', { name: title })).toBeVisible()
    expect(screen.getByRole('button', { name: action })).toBeEnabled()
    expect(screen.getByText('Cancel')).toBeVisible()
  }
})

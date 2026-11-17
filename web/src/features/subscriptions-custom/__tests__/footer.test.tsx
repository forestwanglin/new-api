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
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import viLocale from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { SubscriptionsCustomFooter } from '../footer'
import { SupportDialog } from '../support-dialog'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: {
    to: string
    className?: string
    children: React.ReactNode
  }) => (
    <a href={props.to} className={props.className}>
      {props.children}
    </a>
  ),
}))
vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({
    status: {
      support_wecom: 'test-wecom',
      operations_email: 'ops@example.com',
    },
  }),
}))
const locales = { en, fr, ja, ru, vi: viLocale, zhCN: zh, zhTW }

afterEach(async () => {
  cleanup()
  for (const language of Object.keys(locales)) {
    i18next.removeResourceBundle(language, 'translation')
  }
  i18next.addResourceBundle('en', 'translation', {})
  await i18next.changeLanguage('en')
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

it.each(Object.entries(locales))(
  'uses configured branding and translated footer/support text for %s',
  async (language, resource) => {
    i18next.addResourceBundle(language, 'translation', resource.translation)
    await i18next.changeLanguage(language)
    useSystemConfigStore
      .getState()
      .setConfig({ systemName: 'Configured Site', logo: '/custom-logo.png' })
    useSystemConfigStore.getState().setLoadedLogoUrl('/custom-logo.png')
    const client = new QueryClient()
    const view = render(
      <QueryClientProvider client={client}>
        <SubscriptionsCustomFooter onContact={() => undefined} />
      </QueryClientProvider>
    )
    const footer = within(screen.getByRole('contentinfo'))
    expect(footer.getByText('Configured Site')).toBeVisible()
    expect(footer.getByRole('img')).toHaveAttribute('src', '/custom-logo.png')
    expect(
      footer.getByText(`© ${new Date().getFullYear()} Configured Site`)
    ).toBeVisible()
    expect(footer.getByText(i18next.t('Help'))).toBeVisible()
    expect(
      footer.getByText(i18next.t('footer.newapi.projectAttributionSuffix'), {
        exact: false,
      })
    ).toBeVisible()
    act(() =>
      useSystemConfigStore
        .getState()
        .setConfig({ systemName: 'Updated Site', logo: '/updated.png' })
    )
    expect(
      footer.getByText(`© ${new Date().getFullYear()} Updated Site`)
    ).toBeVisible()
    view.rerender(
      <QueryClientProvider client={client}>
        <SupportDialog open onOpenChange={() => undefined} />
      </QueryClientProvider>
    )
    const dialog = within(
      screen.getByRole('dialog', { name: i18next.t('Contact support') })
    )
    expect(
      dialog.getByText(i18next.t('WeCom (fastest response)'))
    ).toBeVisible()
    expect(dialog.getByText('test-wecom')).toBeVisible()
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await user.click(
      dialog.getByRole('button', { name: i18next.t('Copy WeCom ID') })
    )
    expect(write).toHaveBeenCalledWith('test-wecom')
    write.mockRestore()
  }
)

it('updates footer language after a language switch', async () => {
  for (const [language, resource] of Object.entries(locales)) {
    i18next.addResourceBundle(language, 'translation', resource.translation)
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SubscriptionsCustomFooter onContact={() => undefined} />
    </QueryClientProvider>
  )
  expect(screen.getByRole('heading', { name: 'Help' })).toBeVisible()
  await act(() => i18next.changeLanguage('zhTW'))
  expect(screen.getByRole('heading', { name: '幫助' })).toBeVisible()
})

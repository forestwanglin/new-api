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
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { ReferralPanel } from '../referral-panel'

const i18n = createInstance()

interface SelfFixture {
  quota: number
  used_quota: number
  request_count: number
  aff_count: number
  aff_quota: number
  aff_history_quota: number
}

const SELF_WITHOUT_REWARDS: SelfFixture = {
  quota: 1000000,
  used_quota: 0,
  request_count: 0,
  aff_count: 2,
  aff_quota: 0,
  aff_history_quota: 500000,
}

/** Balance after the mocked transfer lands in `quota`. */
const SELF_AFTER_TRANSFER: SelfFixture = {
  ...SELF_WITHOUT_REWARDS,
  quota: 1500000,
  aff_quota: 500000,
}

let currentSelf: SelfFixture
let transferCompleted: boolean
let client: QueryClient

beforeEach(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'zh',
    fallbackLng: false,
    nsSeparator: false,
    resources: { en, zh },
    interpolation: { escapeValue: false },
  })
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'inviter',
    role: 1,
    quota: 1000000,
  })
  currentSelf = { ...SELF_WITHOUT_REWARDS }
  transferCompleted = false
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    switch (url) {
      case '/api/user/aff':
        return { data: { success: true, data: 'zyycode' } }
      case '/api/user/topup/info':
        return {
          data: { success: true, data: { payment_compliance_confirmed: true } },
        }
      case '/api/user/self':
        return {
          data: {
            success: true,
            data: transferCompleted ? SELF_AFTER_TRANSFER : currentSelf,
          },
        }
      default:
        throw new Error(`Unexpected referral panel request: ${url}`)
    }
  })
  vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url !== '/api/user/aff_transfer') {
      throw new Error(`Unexpected referral panel request: ${url}`)
    }
    transferCompleted = true
    return { data: { success: true, message: 'ok' } }
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  vi.restoreAllMocks()
})

function renderPanel() {
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ReferralPanel />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

it('renders the localized invite heading with the invite link and invite count', async () => {
  renderPanel()

  expect(
    await screen.findByRole('heading', { name: '邀请好友注册' })
  ).toBeVisible()
  expect(screen.getByDisplayValue(/\?aff=zyycode$/)).toBeVisible()
  const invitesCell = screen.getByText('邀请').parentElement
  if (!invitesCell) throw new Error('Invite counter cell is missing')
  expect(within(invitesCell).getByText('2')).toBeVisible()
})

it('offers the transfer action only once rewards are pending', async () => {
  renderPanel()

  await screen.findByRole('heading', { name: '邀请好友注册' })
  expect(
    screen.queryByRole('button', { name: '转移到余额' })
  ).not.toBeInTheDocument()

  currentSelf = { ...SELF_WITHOUT_REWARDS, aff_quota: 500000 }
  client.clear()
  cleanup()
  renderPanel()

  expect(
    await screen.findByRole('button', { name: '转移到余额' })
  ).toBeVisible()
})

it('transfers the pending rewards and syncs the refreshed balance', async () => {
  const user = userEvent.setup()
  currentSelf = { ...SELF_WITHOUT_REWARDS, aff_quota: 500000 }
  renderPanel()

  await user.click(await screen.findByRole('button', { name: '转移到余额' }))
  expect(await screen.findByText('转移奖励')).toBeVisible()

  await user.click(screen.getByRole('button', { name: '转移' }))

  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/api/user/aff_transfer', {
      quota: expect.any(Number),
    })
  )
  // The panel refreshes itself and the summary cards read the same balance.
  await waitFor(() =>
    expect(useAuthStore.getState().auth.user?.quota).toBe(1500000)
  )
  await waitFor(() =>
    expect(screen.queryByText('转移奖励')).not.toBeInTheDocument()
  )
})

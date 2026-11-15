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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { Route } from '@/routes/(auth)/sign-up'
import { Route as RootRoute } from '@/routes/__root'
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'

import { getAffiliateCode, saveAffiliateCode } from '../lib/storage'

const beforeLoad = Route.options.beforeLoad as (options: {
  preload: boolean
  location: { searchStr: string }
}) => Promise<unknown>

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  useAuthStore.getState().auth.reset()
  useLoginModalStore.getState().close()
})
afterEach(() => {
  localStorage.clear()
  useAuthStore.getState().auth.reset()
  useLoginModalStore.getState().close()
})

it('saves a guest invitation before redirecting to the home with the modal open', async () => {
  await expect(
    beforeLoad({ preload: false, location: { searchStr: '?aff=iQO5' } })
  ).rejects.toMatchObject({ options: { to: '/' } })
  expect(getAffiliateCode()).toBe('iQO5')
  expect(useLoginModalStore.getState().isOpen).toBe(true)
})

it('leaves an existing invitation unchanged when the signed-in user visits another invitation', async () => {
  saveAffiliateCode('previous')
  useAuthStore
    .getState()
    .auth.setUser({ id: 42, username: 'existing', role: 1 })
  await expect(
    beforeLoad({ preload: false, location: { searchStr: '?aff=iQO5' } })
  ).rejects.toMatchObject({ options: { to: '/dashboard' } })
  expect(getAffiliateCode()).toBe('previous')
  expect(useLoginModalStore.getState().isOpen).toBe(false)
})

it('does not save an invitation or open the modal during preload', async () => {
  saveAffiliateCode('previous')
  await expect(
    beforeLoad({ preload: true, location: { searchStr: '?aff=iQO5' } })
  ).rejects.toMatchObject({ options: { to: '/' } })
  expect(getAffiliateCode()).toBe('previous')
  expect(useLoginModalStore.getState().isOpen).toBe(false)
})

it('keeps a pending invitation when visiting sign-up without aff', async () => {
  saveAffiliateCode('previous')
  await expect(
    beforeLoad({ preload: false, location: { searchStr: '' } })
  ).rejects.toMatchObject({ options: { to: '/' } })
  expect(getAffiliateCode()).toBe('previous')
})

const rootBeforeLoad = RootRoute.options.beforeLoad as (options: {
  preload: boolean
  location: { href: string; pathname: string; searchStr: string }
}) => Promise<unknown>

it.each([false, true])(
  'only captures other guest affiliate URLs on real navigation (preload=%s)',
  async (preload) => {
    saveAffiliateCode('previous')
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: { status: true } },
    })
    await rootBeforeLoad({
      preload,
      location: {
        href: '/model?aff=iQO5',
        pathname: '/model',
        searchStr: '?aff=iQO5',
      },
    })
    expect(getAffiliateCode()).toBe(preload ? 'previous' : 'iQO5')
  }
)

it('does not let the root overwrite an invitation for a signed-in user', async () => {
  saveAffiliateCode('previous')
  useAuthStore
    .getState()
    .auth.setUser({ id: 42, username: 'existing', role: 1 })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { status: true } },
  })
  await rootBeforeLoad({
    preload: false,
    location: {
      href: '/model?aff=iQO5',
      pathname: '/model',
      searchStr: '?aff=iQO5',
    },
  })
  expect(getAffiliateCode()).toBe('previous')
})

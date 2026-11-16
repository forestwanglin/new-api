import { createInstance } from 'i18next'
import { expect, it } from 'vitest'

import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'

import { tierLabel } from '../display'

it.each([
  ['zhCN', zh],
  ['zhTW', zhTW],
] as const)(
  'uses Demo Chinese tier wording for %s and arbitrary thresholds',
  async (language, resource) => {
    const i18n = createInstance()
    await i18n.init({ lng: language, resources: { [language]: resource } })
    expect(
      tierLabel(
        { min_effective_friends: 0, rate_bps: 250 },
        { min_effective_friends: 5, rate_bps: 825 },
        i18n.t
      )
    ).toBe('0—4人')
    expect(
      tierLabel({ min_effective_friends: 5, rate_bps: 825 }, undefined, i18n.t)
    ).toBe('5人及以上')
  }
)

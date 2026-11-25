import { createInstance } from 'i18next'
import { expect, it } from 'vitest'

import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'

import { tierColorProgress, tierLabel, tierMeterHeight } from '../display'

it('assigns progressive color positions across any number of invitation tiers', () => {
  expect(
    Array.from({ length: 5 }, (_, index) => tierColorProgress(index, 5))
  ).toEqual([0, 25, 50, 75, 100])
})

it('keeps a single invitation tier at the light end of the palette', () => {
  expect(tierColorProgress(0, 1)).toBe(0)
})

it('scales tier meter heights progressively across the full tier range', () => {
  expect(
    Array.from({ length: 5 }, (_, index) => tierMeterHeight(index, 5))
  ).toEqual([6, 9, 12, 15, 18])
})

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

it.each([
  ['zhCN', zh, '不限人数'],
  ['zhTW', zhTW, '不限人數'],
] as const)(
  'labels a single tier without a friend minimum as unlimited for %s',
  async (language, resource, expected) => {
    const i18n = createInstance()
    await i18n.init({ lng: language, resources: { [language]: resource } })
    expect(
      tierLabel({ min_effective_friends: 0, rate_bps: 500 }, undefined, i18n.t)
    ).toBe(expected)
  }
)

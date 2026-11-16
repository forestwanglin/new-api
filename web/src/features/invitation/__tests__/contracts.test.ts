import { describe, expect, it, beforeEach } from 'vitest'

import { campaignSchema, pageSchema, formatPoints } from '../api'
import {
  saveBindingIntent,
  readBindingIntent,
  clearBindingIntent,
} from '../intent'

describe('invitation contracts', () => {
  beforeEach(() => sessionStorage.clear())
  it('formats points above Number precision without rounding', () => {
    expect(formatPoints('9007199254740993')).toBe('9,007,199,254,740,993')
  })
  it('rejects numeric identifiers and totals', () => {
    expect(campaignSchema.safeParse({ id: 1 }).success).toBe(false)
    expect(
      pageSchema(campaignSchema).safeParse({
        page: 1,
        page_size: 20,
        total: 0,
        items: [],
      }).success
    ).toBe(false)
  })
  it('keeps an anonymous intent temporarily and removes it explicitly', () => {
    saveBindingIntent('https://example.com/?aff=forest', 1000)
    expect(readBindingIntent(1001)).toBe('https://example.com/?aff=forest')
    expect(readBindingIntent(1000 + 15 * 60 * 1000)).toBe('')
    saveBindingIntent('forest')
    clearBindingIntent()
    expect(readBindingIntent()).toBe('')
  })
})

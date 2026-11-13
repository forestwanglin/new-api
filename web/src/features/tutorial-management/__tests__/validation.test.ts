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

import { chapterSchema, groupSchema } from '../lib/schema'

const chapter = {
  group_id: '1',
  anchor: 'doc-create',
  title: 'Create key',
  content_markdown: '**Instructions**',
  sort_order: 0,
  enabled: false,
}
describe('tutorial validation', () => {
  it('accepts unchanged wide string IDs and disabled zero-order content', () => {
    expect(
      chapterSchema.parse({ ...chapter, group_id: '9007199254740993' }).group_id
    ).toBe('9007199254740993')
    expect(chapterSchema.parse(chapter).enabled).toBe(false)
  })
  it('rejects blank, oversized UTF-8 content and unsafe anchors', () => {
    expect(
      chapterSchema.safeParse({ ...chapter, content_markdown: '  ' }).success
    ).toBe(false)
    expect(
      chapterSchema.safeParse({
        ...chapter,
        content_markdown: '中'.repeat(21846),
      }).success
    ).toBe(false)
    expect(
      chapterSchema.safeParse({ ...chapter, anchor: '../bad' }).success
    ).toBe(false)
    expect(
      chapterSchema.safeParse({ ...chapter, group_id: 'invalid' }).success
    ).toBe(false)
  })
  it('rejects an empty group name and out-of-range sort priority', () => {
    expect(
      groupSchema.safeParse({
        group_key: 'start',
        title: ' ',
        sort_order: 0,
        enabled: true,
      }).success
    ).toBe(false)
    expect(
      groupSchema.safeParse({
        group_key: 'start',
        title: 'Start',
        sort_order: 2147483648,
        enabled: true,
      }).success
    ).toBe(false)
  })
})

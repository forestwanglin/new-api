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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it } from 'vitest'

import { RuleContentEditor } from '../content-editor'
import { RuleContentView } from '../rule-content'
import { ruleInputSchema, defaultRuleInput } from '../schema'
import type { RuleContent } from '../types'

it('renders literal markup safely and preserves independent fragment styles', () => {
  const view = render(
    <RuleContentView
      content={{
        blocks: [
          {
            type: 'paragraph',
            children: [
              { text: '<img src=x onerror=alert(1)>' },
              {
                text: 'Reward',
                style: {
                  fontWeight: 700,
                  color: '#0052d9',
                  backgroundColor: '#eaf3ff',
                },
              },
            ],
          },
        ],
      }}
    />
  )
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
  expect(view.container.querySelector('img')).toBeNull()
  expect(screen.getByText('Reward')).toHaveStyle({
    color: '#0052d9',
    backgroundColor: '#eaf3ff',
    fontWeight: '700',
  })
})
it('edits phrase colors and bold, adds paragraphs and resets style without changing text', async () => {
  const user = userEvent.setup()
  function Editor() {
    const [content, setContent] = useState<RuleContent>({
      blocks: [{ type: 'paragraph', children: [{ text: 'Reward' }] }],
    })
    return (
      <>
        <RuleContentEditor value={content} onChange={setContent} />
        <section aria-label='Preview'>
          <RuleContentView content={content} />
        </section>
      </>
    )
  }
  render(<Editor />)
  await user.type(
    screen.getByRole('textbox', { name: 'Text color' }),
    '#0052d9'
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Highlight color' }),
    '#eaf3ff'
  )
  await user.click(screen.getByRole('switch', { name: 'Bold' }))
  const preview = within(screen.getByRole('region', { name: 'Preview' }))
  expect(preview.getByText('Reward')).toHaveStyle({
    color: '#0052d9',
    backgroundColor: '#eaf3ff',
    fontWeight: '700',
  })
  await user.click(screen.getByRole('button', { name: 'Reset style' }))
  expect(preview.getByText('Reward').style.cssText).toBe('')
  await user.click(screen.getByRole('button', { name: 'Add fragment' }))
  expect(
    screen.getAllByRole('textbox', { name: /Text fragment/ })
  ).toHaveLength(2)
  await user.click(screen.getByRole('button', { name: 'Add paragraph' }))
  expect(screen.getAllByRole('group')).toHaveLength(2)
})
it('rejects arbitrary style fields, invalid colors, blank documents and oversized content', () => {
  const base = {
    ...defaultRuleInput,
    title: 'Rule',
    rule_key: 'renewal',
    content: {
      blocks: [{ type: 'paragraph', children: [{ text: 'Reward' }] }],
    },
  }
  expect(ruleInputSchema.safeParse(base).success).toBe(true)
  for (const style of [
    { color: 'url(https://example.test)' },
    { position: 'fixed' },
    { fontWeight: 100 },
    { backgroundColor: '#fff' },
  ]) {
    expect(
      ruleInputSchema.safeParse({
        ...base,
        content: {
          blocks: [
            { type: 'paragraph', children: [{ text: 'Reward', style }] },
          ],
        },
      }).success
    ).toBe(false)
  }
  for (const text of ['  ', '🚀'.repeat(10001)]) {
    expect(
      ruleInputSchema.safeParse({
        ...base,
        content: { blocks: [{ type: 'paragraph', children: [{ text }] }] },
      }).success
    ).toBe(false)
  }
})

it('counts supplementary Unicode characters correctly and rejects invalid scope IDs without throwing', () => {
  const base = {
    ...defaultRuleInput,
    title: 'Rule',
    rule_key: 'unicode',
    content: {
      blocks: [
        {
          type: 'paragraph' as const,
          children: [{ text: '🚀'.repeat(10000) }],
        },
      ],
    },
  }
  expect(ruleInputSchema.safeParse(base).success).toBe(true)
  for (const plan_id of ['abc', '-1', '0', '9223372036854775808']) {
    expect(ruleInputSchema.safeParse({ ...base, plan_id }).success).toBe(false)
  }
})

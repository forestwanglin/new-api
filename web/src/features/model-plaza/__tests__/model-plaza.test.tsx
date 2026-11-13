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
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { ModelPlaza } from '..'
import {
  callsPerYuan,
  discountLabel,
  officialCallsPerYuan,
  pointsPerCall,
  savingPercent,
  TEXT_MODELS,
  VIDEO_MODELS,
} from '../catalog'

vi.mock('@/components/layout', () => ({
  PublicLayout: (props: { children: React.ReactNode }) => (
    <div>{props.children}</div>
  ),
}))

// Router links are rendered as plain anchors; the page tests never navigate.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: (props: { to: string; children?: React.ReactNode }) => (
    <a href={props.to}>{props.children}</a>
  ),
}))

afterEach(cleanup)

function renderPlaza() {
  return render(<ModelPlaza />)
}

const flash = TEXT_MODELS[0]

it('renders every catalog entry and the video section', () => {
  renderPlaza()
  expect(screen.getByRole('heading', { level: 1, name: '模型' })).toBeVisible()
  expect(
    screen.getByText(`共 ${TEXT_MODELS.length + VIDEO_MODELS.length} 项`)
  ).toBeVisible()
  for (const model of TEXT_MODELS) {
    expect(screen.getByText(model.id)).toBeVisible()
  }
  expect(
    screen.getByRole('heading', { level: 3, name: '视频生成价格' })
  ).toBeVisible()
  for (const video of VIDEO_MODELS) {
    expect(screen.getByText(video.name)).toBeVisible()
  }
})

it('derives per-call points, calls per yuan and discount from the catalog', () => {
  // 2,000 input / 500 output tokens at 0.0014 / 0.0056 元 per 1K tokens
  expect(pointsPerCall(flash)).toBe(6)
  expect(callsPerYuan(flash)).toBe(166)
  expect(officialCallsPerYuan(flash)).toBe(125)
  expect(discountLabel(flash)).toBe('7.5 折')
  expect(savingPercent(flash)).toBe(25)

  renderPlaza()
  const row = within(
    screen.getByRole('row', { name: /^deepseek-v4\.1-flash(?!-)/ })
  )
  expect(row.getByText('125 次')).toBeVisible()
  expect(row.getByText('166 次')).toBeVisible()
  expect(row.getByText('7.5 折')).toBeVisible()
  expect(row.getByText('比官网省 25%')).toBeVisible()
  expect(row.getByRole('link', { name: '使用此模型' })).toHaveAttribute(
    'href',
    '/sign-in'
  )
})

it('narrows the table by vendor and by keyword', async () => {
  const user = userEvent.setup()
  renderPlaza()

  await user.click(screen.getByRole('button', { name: /DeepSeek/ }))
  expect(
    screen.getByRole('heading', { level: 2, name: 'DeepSeek' })
  ).toBeVisible()
  expect(screen.getByText('共 5 项')).toBeVisible()
  expect(screen.queryByText('glm-5.3-flash')).toBeNull()

  await user.click(screen.getByRole('button', { name: /^所有模型/ }))
  expect(
    screen.getByText(`共 ${TEXT_MODELS.length + VIDEO_MODELS.length} 项`)
  ).toBeVisible()

  await user.type(screen.getByRole('searchbox'), 'long-doc-no-match')
  expect(screen.getByText('没找到匹配的模型，换个关键词试试')).toBeVisible()
})

it('offers overseas models as read-only and keeps domestic ones actionable', () => {
  renderPlaza()
  const overseas = within(screen.getByRole('row', { name: /claude-sonnet-5/ }))
  expect(overseas.getByText('暂不开放')).toBeVisible()
  expect(overseas.queryByText('使用此模型')).toBeNull()
})

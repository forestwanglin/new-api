/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the License,
or (at your option) any later version.
*/
import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, expect, it } from 'vitest'

const css = readFileSync(
  `${process.cwd()}/src/styles/general-console.css`,
  'utf8'
)
let stylesheet: HTMLStyleElement
let page: HTMLDivElement
let outside: HTMLDivElement

beforeEach(() => {
  stylesheet = document.createElement('style')
  stylesheet.textContent = css
  document.head.append(stylesheet)
  page = document.createElement('div')
  page.className = 'general-console-page'
  page.innerHTML = `
    <div data-slot="section-page-header"><h2 data-slot="section-page-title">Page</h2></div>
    <div data-slot="section-page-content" style="overflow:auto">
      <div class="general-card"><h2>Panel</h2></div>
    </div>`
  outside = document.createElement('div')
  outside.innerHTML = '<div class="general-card"><h2>Shared panel</h2></div>'
  document.body.append(page, outside)
})

afterEach(() => {
  document.documentElement.classList.remove('dark')
  stylesheet.remove()
  page.remove()
  outside.remove()
})

it('applies the demo palette only to an explicitly opted-in page', () => {
  expect(getComputedStyle(page).getPropertyValue('--primary').trim()).toBe(
    '#2563eb'
  )
  expect(
    getComputedStyle(page).getPropertyValue('--general-page-bg').trim()
  ).toBe('#f8fafd')
  expect(getComputedStyle(outside).getPropertyValue('--primary')).toBe('')
  expect(
    getComputedStyle(page.querySelector('.general-card') as HTMLElement)
      .borderRadius
  ).toBe('14px')
  expect(
    getComputedStyle(outside.querySelector('.general-card') as HTMLElement)
      .borderRadius
  ).toBe('')
})

it('preserves the active dark palette and restores the demo palette after switching back', () => {
  document.documentElement.classList.add('dark')
  expect(getComputedStyle(page).getPropertyValue('--primary')).toBe('')
  expect(
    getComputedStyle(page).getPropertyValue('--general-page-bg').trim()
  ).toBe('var(--background)')
  document.documentElement.classList.remove('dark')
  expect(getComputedStyle(page).getPropertyValue('--primary').trim()).toBe(
    '#2563eb'
  )
})

it('styles the page heading without imposing its typography on panel headings or changing scrolling', () => {
  const heading = page.querySelector<HTMLElement>(
    '[data-slot="section-page-title"]'
  ) as HTMLElement
  const panelHeading = page.querySelector<HTMLElement>(
    '.general-card h2'
  ) as HTMLElement
  const content = page.querySelector<HTMLElement>(
    '[data-slot="section-page-content"]'
  ) as HTMLElement
  expect(getComputedStyle(heading).letterSpacing).toBe('-0.6px')
  expect(getComputedStyle(panelHeading).letterSpacing).not.toBe('-0.6px')
  expect(getComputedStyle(content).overflow).toBe('auto')
})

it('keeps dashboard cards and key tables contained while preserving table scrolling', () => {
  page.innerHTML = `
    <div class="general-card general-chart-panel" style="overflow:hidden">
      <div class="general-chart-heading">Consumption</div>
    </div>
    <div class="general-table-surface" style="overflow:auto">
      <table><thead><tr><th data-slot="table-head">Key</th></tr></thead>
      <tbody><tr><td data-slot="table-cell">An existing key</td></tr></tbody></table>
    </div>`
  const card = page.querySelector<HTMLElement>('.general-card') as HTMLElement
  const table = page.querySelector<HTMLElement>(
    '.general-table-surface'
  ) as HTMLElement
  expect(getComputedStyle(card).minWidth).toBe('0px')
  expect(getComputedStyle(card).overflow).toBe('hidden')
  expect(getComputedStyle(table).borderRadius).toBe('12px')
  expect(getComputedStyle(table).overflow).toBe('auto')
  expect(
    getComputedStyle(page.querySelector('th') as HTMLElement).paddingBlock
  ).toBe('12px')
  expect(
    getComputedStyle(page.querySelector('td') as HTMLElement).paddingBlock
  ).toBe('13px')
})

it.each([1, 2, 3, 4, 5])(
  'deepens chart %s badge text only on an opted-in light page without changing the chart hue',
  (index) => {
    const selector = `[data-slot='status-badge'].text-chart-${index}`
    page.innerHTML = `<span data-slot="status-badge" class="text-chart-${index}">Group</span>`
    outside.innerHTML = page.innerHTML
    const badge = page.querySelector<HTMLElement>(selector)
    const outsideBadge = outside.querySelector<HTMLElement>(selector)
    expect(badge).not.toBeNull()
    expect(outsideBadge).not.toBeNull()
    const badgeRule = [...(stylesheet.sheet as CSSStyleSheet).cssRules].find(
      (entry): entry is CSSStyleRule =>
        'selectorText' in entry && String(entry.selectorText).includes(selector)
    )
    expect(badgeRule?.style.color).toBe(
      `color-mix(in oklch, var(--chart-${index}) 35%, var(--foreground))`
    )
    if (!badge || !outsideBadge || !badgeRule) {
      throw new Error('Missing badge fixture or contrast rule')
    }
    expect(badge.matches(badgeRule.selectorText)).toBe(true)
    expect(outsideBadge.matches(badgeRule.selectorText)).toBe(false)
    expect(getComputedStyle(page).getPropertyValue(`--chart-${index}`)).toBe('')
    document.documentElement.classList.add('dark')
    expect(badge.matches(badgeRule.selectorText)).toBe(false)
  }
)

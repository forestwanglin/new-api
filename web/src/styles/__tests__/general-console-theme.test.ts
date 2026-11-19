/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, expect, it } from 'vitest'

const css = readFileSync(
  `${process.cwd()}/src/styles/general-console.css`,
  'utf8'
)
const themeTokens = [
  '--background',
  '--card',
  '--foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--border',
  '--input',
  '--ring',
  '--table-header',
]
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
  delete document.body.dataset.themePreset
  stylesheet.remove()
  page.remove()
  outside.remove()
})

it('uses the demo canvas in the default light theme and follows the selected theme otherwise', () => {
  expect(
    getComputedStyle(page).getPropertyValue('--general-page-bg').trim()
  ).toBe('#f8fafd')
  document.body.dataset.themePreset = 'ocean-breeze'
  expect(
    getComputedStyle(page).getPropertyValue('--general-page-bg').trim()
  ).toBe('var(--muted)')
  document.body.dataset.themePreset = 'default'
  expect(
    getComputedStyle(page).getPropertyValue('--general-page-bg').trim()
  ).toBe('#f8fafd')
  delete document.body.dataset.themePreset
  document.documentElement.classList.add('dark')
  expect(
    getComputedStyle(page).getPropertyValue('--general-page-bg').trim()
  ).toBe('var(--muted)')
})

it('inherits the theme palette instead of redefining it', () => {
  for (const token of themeTokens) {
    expect(css).not.toMatch(new RegExp(`${token}\\s*:`))
  }
  const style = getComputedStyle(page)
  expect(style.getPropertyValue('--general-surface').trim()).toBe('var(--card)')
  expect(style.getPropertyValue('--general-inset').trim()).toBe('var(--muted)')
  expect(style.getPropertyValue('--general-line').trim()).toBe('var(--border)')
  expect(style.getPropertyValue('--general-control-line').trim()).toBe(
    'var(--input)'
  )
})

it('applies the demo card treatment only to an explicitly opted-in page', () => {
  expect(
    getComputedStyle(page.querySelector('.general-card') as HTMLElement)
      .borderRadius
  ).toBe('14px')
  expect(
    getComputedStyle(outside.querySelector('.general-card') as HTMLElement)
      .borderRadius
  ).toBe('')
})

it('derives the onboarding accent border from the primary color', () => {
  const rule = [...(stylesheet.sheet as CSSStyleSheet).cssRules].find(
    (entry): entry is CSSStyleRule =>
      entry instanceof CSSStyleRule &&
      entry.selectorText === '.general-console-page .general-access-card'
  )
  expect(rule?.style.getPropertyValue('border-color')).toBe(
    'color-mix(in oklch, var(--primary) 25%, var(--general-line))'
  )
})

it('uses the dashboard card outline for both onboarding blocks', () => {
  const rule = [...(stylesheet.sheet as CSSStyleSheet).cssRules].find(
    (entry): entry is CSSStyleRule =>
      entry instanceof CSSStyleRule &&
      entry.selectorText.includes('.general-onboarding') &&
      !entry.selectorText.includes('h3')
  )
  expect(rule?.style.getPropertyValue('border-color')).toBe(
    'var(--general-line)'
  )
})

it('matches the onboarding referral heading to the app connection scale', () => {
  const rule = [...(stylesheet.sheet as CSSStyleSheet).cssRules].find(
    (entry): entry is CSSStyleRule =>
      entry instanceof CSSStyleRule &&
      entry.selectorText.includes('.general-onboarding') &&
      entry.selectorText.includes('h3')
  )
  expect(rule?.style.fontSize).toBe('18px')
  expect(rule?.style.fontWeight).toBe('600')
  expect(rule?.style.lineHeight).toBe('1.5')
})

it('fills table headers and deepens rows on hover', () => {
  const rules = [...(stylesheet.sheet as CSSStyleSheet).cssRules].filter(
    (entry): entry is CSSStyleRule => entry instanceof CSSStyleRule
  )
  const header = rules.find(
    (entry) =>
      entry.selectorText === ".general-console-page [data-slot='table-header']"
  )
  expect(header?.style.getPropertyValue('background-color')).toBe(
    'var(--muted)'
  )
  expect(header?.style.getPropertyValue('--table-header-bg')).toBe(
    'var(--muted)'
  )
  expect(header?.style.getPropertyValue('--table-header-hover')).toBe(
    'var(--muted)'
  )
  const row = rules.find(
    (entry) =>
      entry.selectorText ===
      ".general-console-page [data-slot='table-row']:hover"
  )
  expect(row?.style.getPropertyValue('background-color')).toBe('var(--muted)')
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

/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the License,
or (at your option) any later version.
*/
import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, expect, it } from 'vitest'

const invitationCSS = readFileSync(
  `${process.cwd()}/src/styles/invitation.css`,
  'utf8'
)

let stylesheet: HTMLStyleElement
let page: HTMLDivElement
beforeEach(() => {
  stylesheet = document.createElement('style')
  stylesheet.textContent = invitationCSS
  document.head.append(stylesheet)
  page = document.createElement('div')
  page.className = 'invitation-page'
  page.innerHTML = `
    <div class="iv-activity">
      <div class="iv-rules-section">Rules</div>
    </div>
    <div class="iv-ref-form"><input /></div>
  `
  document.body.append(page)
})
afterEach(() => {
  document.documentElement.classList.remove('dark')
  stylesheet.remove()
  page.remove()
})

it('uses dark surfaces and readable text for invitation rules and inviter input', () => {
  document.documentElement.classList.add('dark')
  const rules = page.querySelector<HTMLElement>('.iv-rules-section')
  const activity = page.querySelector<HTMLElement>('.iv-activity')
  const input = page.querySelector<HTMLInputElement>('input')
  expect(rules).not.toBeNull()
  expect(activity).not.toBeNull()
  expect(input).not.toBeNull()
  if (!rules || !activity || !input) return
  expect(getComputedStyle(activity).backgroundColor).toBe('rgb(24, 34, 49)')
  expect(getComputedStyle(rules).color).toBe('var(--tx)')
  expect(getComputedStyle(page).getPropertyValue('--tx').trim()).toBe('#e2e8f0')
  expect(getComputedStyle(input).backgroundColor).toBe('rgb(35, 50, 74)')
  expect(getComputedStyle(input).color).toBe('var(--tx)')
})

it('uses a dark period badge in the all activities dialog', () => {
  const modal = document.createElement('div')
  modal.className = 'iv-activity-modal'
  modal.innerHTML = '<span class="iv-list-period">Period 1</span>'
  page.append(modal)
  document.documentElement.classList.add('dark')
  const period = modal.querySelector<HTMLElement>('.iv-list-period')
  expect(period).not.toBeNull()
  if (!period) return
  expect(getComputedStyle(period).backgroundColor).toBe('rgb(35, 50, 74)')
  expect(getComputedStyle(period).color).toBe('rgb(191, 219, 254)')
})

it('restores light surfaces when switching out of dark mode', () => {
  const activity = page.querySelector<HTMLElement>('.iv-activity')
  const input = page.querySelector<HTMLInputElement>('input')
  expect(activity).not.toBeNull()
  expect(input).not.toBeNull()
  if (!activity || !input) return
  document.documentElement.classList.add('dark')
  document.documentElement.classList.remove('dark')
  expect(getComputedStyle(activity).backgroundColor).toBe('rgb(255, 255, 255)')
  expect(getComputedStyle(input).backgroundColor).toBe('rgb(255, 255, 255)')
  expect(getComputedStyle(page).getPropertyValue('--tx').trim()).toBe('#0f172a')
})

it('uses a readable progressive tier palette when switching themes', () => {
  const tier = document.createElement('div')
  tier.className = 'iv-tier'
  page.append(tier)
  expect(getComputedStyle(tier).getPropertyValue('--tier-light').trim()).toBe(
    '#668bbd'
  )
  expect(getComputedStyle(tier).getPropertyValue('--tier-dark').trim()).toBe(
    '#003a9b'
  )
  document.documentElement.classList.add('dark')
  expect(getComputedStyle(tier).getPropertyValue('--tier-light').trim()).toBe(
    '#a7c7ff'
  )
  expect(getComputedStyle(tier).getPropertyValue('--tier-dark').trim()).toBe(
    '#5b89d8'
  )
})

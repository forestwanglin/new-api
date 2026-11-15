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
import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, expect, it } from 'vitest'

const modalCSS = readFileSync(
  `${process.cwd()}/src/styles/login-modal.css`,
  'utf8'
)

let stylesheet: HTMLStyleElement
let dialog: HTMLDivElement
beforeEach(() => {
  stylesheet = document.createElement('style')
  stylesheet.textContent = modalCSS
  document.head.append(stylesheet)
  dialog = document.createElement('div')
  dialog.className = 'login-modal'
  dialog.dataset.slot = 'dialog-content'
  document.body.append(dialog)
})
afterEach(() => {
  document.documentElement.classList.remove('dark')
  stylesheet.remove()
  dialog.remove()
})

it('keeps the light login dialog palette when dark mode is disabled', () => {
  expect(getComputedStyle(dialog).getPropertyValue('--surface').trim()).toBe(
    '#fff'
  )
  expect(getComputedStyle(dialog).getPropertyValue('--tx').trim()).toBe(
    '#0f172a'
  )
})

it('inherits dark theme surfaces and readable text when dark mode is enabled', () => {
  document.documentElement.classList.add('dark')
  const style = getComputedStyle(dialog)
  expect(style.getPropertyValue('--surface').trim()).toBe('var(--card)')
  expect(style.getPropertyValue('--soft').trim()).toBe('var(--muted)')
  expect(style.getPropertyValue('--tx').trim()).toBe('var(--foreground)')
  expect(style.getPropertyValue('--tx2').trim()).toBe('var(--muted-foreground)')
  expect(style.getPropertyValue('--line').trim()).toBe('var(--border)')
  expect(style.getPropertyValue('--error-text').trim()).toBe(
    'var(--destructive)'
  )
})

it('restores the light palette when the user switches back from dark mode', () => {
  document.documentElement.classList.add('dark')
  expect(getComputedStyle(dialog).getPropertyValue('--surface').trim()).toBe(
    'var(--card)'
  )
  document.documentElement.classList.remove('dark')
  expect(getComputedStyle(dialog).getPropertyValue('--surface').trim()).toBe(
    '#fff'
  )
})

it('keeps white submit text in light mode and follows the primary contrast token in dark mode', () => {
  expect(
    getComputedStyle(dialog).getPropertyValue('--submit-text').trim()
  ).toBe('#fff')
  document.documentElement.classList.add('dark')
  expect(
    getComputedStyle(dialog).getPropertyValue('--submit-text').trim()
  ).toBe('var(--primary-foreground)')
  document.documentElement.classList.remove('dark')
  expect(
    getComputedStyle(dialog).getPropertyValue('--submit-text').trim()
  ).toBe('#fff')
})

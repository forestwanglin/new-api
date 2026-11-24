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

const checkoutCSS = readFileSync(
  `${process.cwd()}/src/styles/subscriptions-custom.css`,
  'utf8'
)
let stylesheet: HTMLStyleElement
let checkout: HTMLDivElement
beforeEach(() => {
  stylesheet = document.createElement('style')
  stylesheet.textContent = checkoutCSS
  document.head.append(stylesheet)
  checkout = document.createElement('div')
  checkout.className = 'sub-checkout'
  checkout.innerHTML = `<div class="sub-checkout-footer">
    <div class="agreement-consent"><button class="agreement-document-link" type="button">Agreement</button></div>
    <button type="button" aria-label="Cancel">Cancel</button>
    <button type="button" aria-label="Pay">Pay</button>
  </div>`
  document.body.append(checkout)
})
afterEach(() => {
  stylesheet.remove()
  checkout.remove()
})
it('retains the cancel border color after adding the agreement row', () => {
  const cancel = checkout.querySelector<HTMLButtonElement>(
    '[aria-label="Cancel"]'
  )
  if (!cancel || !stylesheet.sheet) {
    throw new Error('Expected styled cancel button')
  }
  const rule = [...stylesheet.sheet.cssRules].find(
    (rule): rule is CSSStyleRule =>
      rule instanceof CSSStyleRule &&
      rule.style.getPropertyValue('border-color') ===
        'var(--sub-checkout-button-line)'
  )
  if (!rule) {
    throw new Error('Expected cancel border style')
  }
  expect(cancel.matches(rule.selectorText)).toBe(true)
})
it('keeps the cancel hover surface theme-aware in dark mode', () => {
  const normalize = (selector: string) => selector.replaceAll(/\s+/g, ' ')
  const rules = [...(stylesheet.sheet as CSSStyleSheet).cssRules].filter(
    (entry): entry is CSSStyleRule => entry instanceof CSSStyleRule
  )
  const lightHover = rules.find(
    (entry) =>
      normalize(entry.selectorText) ===
      '.sub-checkout .sub-checkout-footer > button:first-of-type:hover:not(:disabled)'
  )
  expect(lightHover?.style.getPropertyValue('background')).toBe(
    'rgb(245, 247, 250)'
  )
  const darkHover = rules.find(
    (entry) =>
      normalize(entry.selectorText) ===
      '.dark .sub-checkout .sub-checkout-footer > button:first-of-type:hover:not(:disabled)'
  )
  expect(darkHover?.style.getPropertyValue('background')).toBe('var(--muted)')
  expect(darkHover?.style.getPropertyValue('border-color')).toBe(
    'var(--border)'
  )
})
it('keeps payment button sizing out of the nested agreement title', () => {
  const agreement = checkout.querySelector<HTMLButtonElement>(
    '.agreement-document-link'
  )
  const pay = checkout.querySelector<HTMLButtonElement>('[aria-label="Pay"]')
  if (!agreement || !pay) {
    throw new Error('Expected payment and agreement buttons')
  }
  expect(getComputedStyle(pay).padding).toBe('10px 18px')
  expect(getComputedStyle(agreement).padding).not.toBe('10px 18px')
})

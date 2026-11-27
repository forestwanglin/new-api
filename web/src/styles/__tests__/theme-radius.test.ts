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

import { afterEach, expect, it } from 'vitest'

const themeCss = readFileSync(`${process.cwd()}/src/styles/theme.css`, 'utf8')
const presetsCss = readFileSync(
  `${process.cwd()}/src/styles/theme-presets.css`,
  'utf8'
)

// Derived radius tokens declared in theme.css's `@theme inline` block.
// Tailwind emits them on `:root`, where `var(--radius)` substitutes against
// the 1rem default and the computed values are inherited frozen.
const derivedTokens = [
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--radius-2xl',
  '--radius-3xl',
  '--radius-4xl',
] as const

let stylesheets: HTMLStyleElement[] = []

afterEach(() => {
  for (const stylesheet of stylesheets) stylesheet.remove()
  stylesheets = []
  for (const name of document.body.getAttributeNames()) {
    if (name.startsWith('data-theme-')) document.body.removeAttribute(name)
  }
})

function mount(css: string): HTMLStyleElement {
  const stylesheet = document.createElement('style')
  stylesheet.textContent = css
  document.head.append(stylesheet)
  stylesheets.push(stylesheet)
  return stylesheet
}

it('re-declares the derived radius tokens on <body> so they track the effective --radius', () => {
  const stylesheet = mount(themeCss)
  const bodyRules = [...(stylesheet.sheet as CSSStyleSheet).cssRules].filter(
    (rule): rule is CSSStyleRule =>
      rule instanceof CSSStyleRule && rule.selectorText === 'body'
  )
  for (const token of derivedTokens) {
    const declared = bodyRules
      .map((rule) => rule.style.getPropertyValue(token))
      .find((value) => value !== '')
    expect(declared, `theme.css must declare ${token} on body`).toBeDefined()
    expect(declared).toMatch(/var\(--radius\)/)
  }
})

it.each([
  ['data-theme-radius', 'sm'],
  ['data-theme-preset', 'ocean-breeze'],
])(
  'computes the derived tokens against the %s=%s --radius override on <body>',
  (attribute, value) => {
    mount(themeCss)
    mount(presetsCss)
    document.body.setAttribute(attribute, value)
    const style = getComputedStyle(document.body)
    expect(style.getPropertyValue('--radius').trim()).toBe('0.3rem')
    for (const token of derivedTokens) {
      expect(style.getPropertyValue(token), token).toMatch(/var\(--radius\)/)
    }
  }
)

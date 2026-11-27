import { readFileSync } from 'node:fs'

import { afterEach, expect, it } from 'vitest'

const stylesheets = [
  'personal-profile',
  'security-access',
  'subscriptions-custom',
].map((name) => {
  const style = document.createElement('style')
  style.textContent = readFileSync(
    `${process.cwd()}/src/styles/${name}.css`,
    'utf8'
  )
  document.head.append(style)
  return { name, style }
})

afterEach(() => {
  // The style elements stay in the document: vitest gives each test file a
  // fresh jsdom environment, and removing them would null out `style.sheet`
  // for the remaining cases in this file.
  document.body.replaceChildren()
})

/**
 * Collects every `border-radius` declaration that applies to the fixture's
 * target element, including rules nested in `@media` blocks. jsdom does not
 * resolve `var()`, so the raw token expressions come back verbatim.
 */
function radiiFor(name: string, fixture: string, target: string): string[] {
  const entry = stylesheets.find((sheet) => sheet.name === name)
  if (!entry || !entry.style.sheet) throw new Error(`Missing ${name} fixture`)
  const host = document.createElement('div')
  host.innerHTML = fixture
  document.body.append(host)
  const element = host.querySelector(target)
  if (!element) throw new Error(`Missing ${target} element in fixture`)
  const radii: string[] = []
  const visit = (list: CSSRuleList) => {
    for (const rule of list) {
      if (rule instanceof CSSMediaRule) {
        visit(rule.cssRules)
      } else if (
        rule instanceof CSSStyleRule &&
        rule.style.borderRadius &&
        element.matches(rule.selectorText)
      ) {
        radii.push(rule.style.borderRadius)
      }
    }
  }
  visit(entry.style.sheet.cssRules)
  host.remove()
  return radii
}

it.each([
  [
    'personal-profile',
    '<main class="personal-profile-page"><section class="pp-card"></section></main>',
    '.pp-card',
    ['var(--radius-lg)'],
  ],
  [
    'personal-profile',
    '<main class="personal-profile-page"><input class="pp-input"></main>',
    '.pp-input',
    ['var(--radius-md)'],
  ],
  [
    'personal-profile',
    '<main class="personal-profile-page"><button class="pp-button"></button></main>',
    '.pp-button',
    ['var(--radius-md)'],
  ],
  [
    'personal-profile',
    '<div class="personal-profile-phone-dialog"></div>',
    '.personal-profile-phone-dialog',
    ['var(--radius-lg)'],
  ],
  [
    'personal-profile',
    '<main class="personal-profile-page"><div class="pp-language-select"><div data-slot="input-group"></div></div></main>',
    '[data-slot="input-group"]',
    ['var(--radius-md)'],
  ],
  [
    'security-access',
    '<main class="security-access-page"><section class="sa-card"></section></main>',
    '.sa-card',
    ['var(--radius-lg)'],
  ],
  [
    'security-access',
    '<main class="security-access-page"><div class="sa-nav"><button role="tab"></button></div></main>',
    'button[role="tab"]',
    ['var(--radius-sm)', 'var(--radius-xl)'],
  ],
  [
    'security-access',
    '<main class="security-access-page"><div class="sa-binding-row"><input></div></main>',
    'input',
    ['var(--radius-md)'],
  ],
  [
    'security-access',
    '<main class="security-access-page"><div class="sa-binding-row"><button></button></div></main>',
    'button',
    ['var(--radius-md)'],
  ],
  [
    'security-access',
    '<main class="security-access-page"><div class="sa-danger"></div></main>',
    '.sa-danger',
    ['var(--radius-md)'],
  ],
  [
    'security-access',
    '<main class="security-access-page"><div class="sa-device"><div></div></div></main>',
    '.sa-device > div:first-child',
    ['var(--radius-sm)'],
  ],
  [
    'subscriptions-custom',
    '<main class="subscriptions-custom"><section class="sub-card"></section></main>',
    '.sub-card',
    ['var(--radius-lg)'],
  ],
])(
  'keeps %s surfaces on the theme radius scale',
  (file, fixture, target, expected) => {
    expect(radiiFor(file, fixture, target)).toEqual(expected)
  }
)

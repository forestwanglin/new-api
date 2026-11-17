import { readFileSync } from 'node:fs'

import { afterEach, expect, it } from 'vitest'

const stylesheet = document.createElement('style')
stylesheet.textContent = [
  'user-page',
  'points-account',
  'personal-profile',
  'security-access',
]
  .map((name) =>
    readFileSync(`${process.cwd()}/src/styles/${name}.css`, 'utf8')
  )
  .join('\n')

afterEach(() => {
  stylesheet.remove()
  document.body.replaceChildren()
  delete document.body.dataset.themePreset
  document.documentElement.classList.remove('dark')
})

it('uses the demo canvas in the default light theme and follows the selected theme otherwise', () => {
  document.head.append(stylesheet)
  const page = document.createElement('main')
  page.className = 'user-page'
  document.body.append(page)
  expect(getComputedStyle(page).getPropertyValue('--user-page-bg').trim()).toBe(
    '#f8fafd'
  )
  document.body.dataset.themePreset = 'ocean-breeze'
  expect(getComputedStyle(page).getPropertyValue('--user-page-bg').trim()).toBe(
    'var(--muted)'
  )
  document.body.dataset.themePreset = 'default'
  expect(getComputedStyle(page).getPropertyValue('--user-page-bg').trim()).toBe(
    '#f8fafd'
  )
  document.documentElement.classList.add('dark')
  expect(getComputedStyle(page).getPropertyValue('--user-page-bg').trim()).toBe(
    'var(--muted)'
  )
})

it.each([
  ['user-page', 'points-account', 'account-card'],
  ['user-page', 'points-account account-subscriptions', 'account-card'],
  ['user-page personal-profile-page', '', 'pp-card'],
  ['user-page security-access-page', '', 'sa-card'],
])(
  'keeps %s %s surfaces connected to the theme palette',
  (pageClass, contentClass, cardClass) => {
    document.head.append(stylesheet)
    const page = document.createElement('main')
    page.className = pageClass
    page.innerHTML = `<div class="${contentClass}"><section class="${cardClass}">Panel</section></div>`
    document.body.append(page)
    const card = page.querySelector('section')
    expect(card).not.toBeNull()
    if (!card || !stylesheet.sheet) throw new Error('Missing style fixture')
    const rules = [...stylesheet.sheet.cssRules]
      .reverse()
      .filter(
        (rule): rule is CSSStyleRule =>
          rule instanceof CSSStyleRule && card.matches(rule.selectorText)
      )
    expect(rules.find((rule) => rule.style.background)?.style.background).toBe(
      'var(--card)'
    )
    expect(rules.find((rule) => rule.style.border)?.style.border).toBe(
      '1px solid var(--border)'
    )
  }
)

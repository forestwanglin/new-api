import { render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { expect, it } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'

import { WeChatVerificationHint } from '../wechat-verification-hint'

it.each([
  ['zh', zh, '扫描二维码关注官方账号，回复“验证码”以接收您的验证码。'],
  [
    'en',
    en,
    'Scan the QR code to follow the official account and send the message “验证码” to receive your verification code.',
  ],
])(
  'highlights the reply keyword in %s without changing the sentence',
  async (language, messages, sentence) => {
    const i18n = createInstance()
    await i18n.use(initReactI18next).init({
      lng: language,
      fallbackLng: false,
      resources: { [language]: messages },
      interpolation: { escapeValue: false },
    })
    render(
      <I18nextProvider i18n={i18n}>
        <WeChatVerificationHint />
      </I18nextProvider>
    )
    const keyword = screen.getByText('验证码')
    expect(keyword.tagName).toBe('STRONG')
    expect(keyword).toHaveClass(
      'font-bold',
      'text-red-700',
      'dark:text-red-400'
    )
    expect(keyword.parentElement?.textContent).toBe(sentence)
  }
)

import { api } from '@/lib/api'
import { authRequestOptions, authResult } from '@/lib/secure-verification'

export type PhoneChangeStatus = {
  bound: boolean
  phone_masked: string
  verification_required: boolean
}
export type PhoneChangeCaptcha = { challenge_token: string; image: string }
export type PhoneCodeResult = { token: string; retry_after: number }
export type PhoneVerifyResult = { token: string }

export type PhoneBindingAuthorization = { token: string; expires_at: number }

export function startPhoneBinding(proof: string, signal: AbortSignal) {
  return authResult<PhoneBindingAuthorization>(
    api.post(
      '/api/user/phone/change/start',
      {},
      {
        ...authRequestOptions,
        signal,
        singleUseAuthorization: true,
        headers: { 'X-Security-Proof': proof },
      }
    )
  )
}

export function getPhoneChangeStatus(signal?: AbortSignal) {
  return authResult<PhoneChangeStatus>(
    api.get('/api/user/phone/change/status', {
      ...authRequestOptions,
      signal,
      disableDuplicate: true,
    })
  )
}

export function getPhoneChangeCaptcha(signal: AbortSignal) {
  return authResult<PhoneChangeCaptcha>(
    api.get('/api/user/phone/change/captcha', {
      ...authRequestOptions,
      signal,
      disableDuplicate: true,
    })
  )
}

export function sendPhoneCode(
  step: 'old' | 'new',
  phone: string,
  verificationToken: string,
  captchaToken: string,
  captchaAnswer: string,
  signal: AbortSignal
) {
  return authResult<PhoneCodeResult>(
    api.post(
      '/api/user/phone/change/send',
      {
        step,
        phone,
        verification_token: verificationToken,
        captcha_token: captchaToken,
        captcha_answer: captchaAnswer,
      },
      {
        ...authRequestOptions,
        signal,
        singleUseAuthorization: true,
      }
    )
  )
}

export function verifyPhoneCode(
  step: 'old' | 'new',
  token: string,
  phone: string,
  code: string,
  signal: AbortSignal
) {
  return authResult<PhoneVerifyResult>(
    api.post(
      '/api/user/phone/change/verify',
      { step, token, phone, code },
      {
        ...authRequestOptions,
        signal,
        singleUseAuthorization: true,
      }
    )
  )
}

export function changePhone(token: string, signal: AbortSignal) {
  return authResult<Record<string, unknown>>(
    api.post(
      '/api/user/phone/change/complete',
      { token },
      {
        ...authRequestOptions,
        signal,
        singleUseAuthorization: true,
        acceptAuthRotation: true,
      }
    )
  )
}

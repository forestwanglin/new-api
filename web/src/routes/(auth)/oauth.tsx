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
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import i18next from 'i18next'
import { useEffect, useRef } from 'react'

import { wechatLoginByCode } from '@/features/auth/api'
import { useAuthRedirect } from '@/features/auth/hooks/use-auth-redirect'
import { handleServerError } from '@/lib/handle-server-error'
import { AuthOperationError } from '@/lib/secure-verification'
import { createServerError } from '@/lib/server-error-message'
import { useLoginModalStore } from '@/stores/login-modal-store'

function OAuthComponent() {
  const navigate = useNavigate()
  const { handleLoginResult } = useAuthRedirect()
  const loginExchange = useRef<{
    key: string
    request: ReturnType<typeof wechatLoginByCode>
  } | null>(null)
  const completedLogin = useRef<string | null>(null)
  const search = useSearch({ from: '/(auth)/oauth' }) as {
    redirect?: string
    provider?: 'github' | 'discord' | 'oidc' | 'linuxdo' | 'telegram' | 'wechat'
    code?: string
    state?: string
  }

  useEffect(() => {
    const loginKey = `${search.provider ?? ''}:${search.code ?? ''}`
    if (completedLogin.current === loginKey) return
    let active = true
    void (async () => {
      try {
        if (search?.provider === 'wechat' && search.code) {
          if (loginExchange.current?.key !== loginKey) {
            loginExchange.current = {
              key: loginKey,
              request: wechatLoginByCode(search.code),
            }
          }
          const res = await loginExchange.current.request
          if (!active) return
          if (res?.success) {
            completedLogin.current = loginKey
            await handleLoginResult(res.data, search.redirect)
            return
          }
          throw createServerError(res, i18next.t('OAuth failed'))
        }
        handleServerError(new AuthOperationError(i18next.t('OAuth failed')))
      } catch (error: unknown) {
        if (!active) return
        handleServerError(
          AuthOperationError.from(error, i18next.t('OAuth failed'))
        )
      }
      useLoginModalStore.getState().open()
      navigate({ to: '/', replace: true })
    })()
    return () => {
      active = false
    }
  }, [
    handleLoginResult,
    navigate,
    search.code,
    search.provider,
    search.redirect,
  ])

  return null
}

export const Route = createFileRoute('/(auth)/oauth')({
  component: OAuthComponent,
})

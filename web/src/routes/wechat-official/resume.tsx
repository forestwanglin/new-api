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
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useAuthRedirect } from '@/features/auth/hooks/use-auth-redirect'
import { sanitizeAuthRedirect } from '@/features/auth/lib/auth-redirect'
import { clearAffiliateCode } from '@/features/auth/lib/storage'
import {
  officialBrowser,
  officialRequest,
} from '@/features/auth/wechat-official/api'
import { getServerErrorMessage } from '@/lib/server-error-message'

function Resume() {
  const { t } = useTranslation()
  const { handleLoginResult } = useAuthRedirect()
  const started = useRef(false)
  const [message, setMessage] = useState('Preparing WeChat authorization...')
  const [target, setTarget] = useState('')
  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        const token = await officialBrowser()
        const flow = await officialRequest<{
          flow_token: string
          intent: string
          aff?: string
          return_target?: string
        }>('flows/resume', {}, token)
        if (flow.intent !== 'login') {
          setMessage(
            'Return to the original security action and confirm again.'
          )
          setTarget(
            sanitizeAuthRedirect(flow.return_target, window.location.origin) ??
              '/security'
          )
          return
        }
        const result = await officialRequest<unknown>(
          'flows/complete',
          { flow_token: flow.flow_token },
          token
        )
        const signedIn = await handleLoginResult(result, flow.return_target)
        if (signedIn) clearAffiliateCode(flow.aff ?? '')
      } catch (failure) {
        setMessage(getServerErrorMessage(failure))
      }
    })()
  }, [handleLoginResult])
  return (
    <main className='mx-auto max-w-md space-y-4 p-6'>
      <p role='status'>{t(message)}</p>
      {target && (
        <Button onClick={() => window.location.replace(target)}>
          {t('Continue')}
        </Button>
      )}
    </main>
  )
}
export const Route = createFileRoute('/wechat-official/resume')({
  component: Resume,
})

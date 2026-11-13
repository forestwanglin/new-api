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
import {
  useRouterState,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout/components/public-layout'
import { Button } from '@/components/ui/button'
import { GeneralError } from '@/features/errors/general-error'
import { AuthenticationRequiredError } from '@/lib/require-authentication'
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'

// The route stops before any protected child or data loader can mount.
export function AuthRequiredGate() {
  const { t } = useTranslation()
  const href = useRouterState({ select: (state) => state.location.href })
  useEffect(() => {
    useLoginModalStore.getState().open({ redirectTo: href })
  }, [href])
  return (
    <PublicLayout>
      <div className='flex min-h-[50svh] items-center justify-center'>
        <Button
          onClick={() =>
            useLoginModalStore.getState().open({ redirectTo: href })
          }
        >
          {t('Register / Sign in')}
        </Button>
      </div>
    </PublicLayout>
  )
}

export function AuthenticationRouteError(
  props: ErrorComponentProps
): ReactNode {
  if (props.error instanceof AuthenticationRequiredError) {
    return <AuthRequiredGate />
  }
  return <GeneralError error={props.error} />
}

// Module visibility can depend on configuration, so remove its mounted content
// immediately on session loss as well as checking it in beforeLoad.
export function AuthenticatedModule(props: {
  requiresAuth: boolean
  children: ReactNode
}) {
  const signedIn = useAuthStore((state) =>
    Boolean(state.auth.user && state.auth.accessToken)
  )
  if (props.requiresAuth && !signedIn) return <AuthRequiredGate />
  return props.children
}

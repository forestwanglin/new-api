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
import { createFileRoute, redirect } from '@tanstack/react-router'
import z from 'zod'

import {
  AuthenticatedModule,
  AuthenticationRouteError,
} from '@/features/auth/components/auth-required-gate'
import { Rankings } from '@/features/rankings'
import { getModuleAccessForGuard } from '@/lib/nav-modules'
import { requireAuthentication } from '@/lib/require-authentication'

const rankingsSearchSchema = z.object({
  period: z
    .enum(['today', 'week', 'month', 'year'])
    .optional()
    .catch(undefined),
})

export const Route = createFileRoute('/rankings/')({
  validateSearch: rankingsSearchSchema,
  beforeLoad: async ({ context }) => {
    const access = await getModuleAccessForGuard(
      context.queryClient,
      'rankings'
    )
    if (!access.enabled) {
      throw redirect({ to: '/' })
    }
    if (access.requireAuth) {
      await requireAuthentication()
    }
    return { requiresAuth: access.requireAuth }
  },
  errorComponent: AuthenticationRouteError,
  component: ModulePage,
})

function ModulePage() {
  const { requiresAuth } = Route.useRouteContext()
  return (
    <AuthenticatedModule requiresAuth={requiresAuth}>
      <Rankings />
    </AuthenticatedModule>
  )
}

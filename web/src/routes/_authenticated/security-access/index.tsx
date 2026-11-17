import { createFileRoute } from '@tanstack/react-router'

import { SecurityAccess } from '@/features/security-access'

export const Route = createFileRoute('/_authenticated/security-access/')({
  component: SecurityAccess,
})

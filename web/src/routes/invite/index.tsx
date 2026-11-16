import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'

import { PublicLayout } from '@/components/layout'
import { InvitationPage } from '@/features/invitation'
import { SubscriptionsCustomFooter } from '@/features/subscriptions-custom/footer'
import { SupportDialog } from '@/features/subscriptions-custom/support-dialog'

export const Route = createFileRoute('/invite/')({
  validateSearch: z.object({
    aff: z.string().max(64).optional().catch(undefined),
    ref: z.string().max(64).optional().catch(undefined),
  }),
  component: InviteRoute,
})
function InviteRoute() {
  const search = Route.useSearch()
  const [supportOpen, setSupportOpen] = useState(false)
  return (
    <PublicLayout showMainContainer={false}>
      <InvitationPage initialInvitation={search.aff ?? search.ref} />
      <SubscriptionsCustomFooter onContact={() => setSupportOpen(true)} />
      <SupportDialog open={supportOpen} onOpenChange={setSupportOpen} />
    </PublicLayout>
  )
}

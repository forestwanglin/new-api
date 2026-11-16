import { createFileRoute, redirect } from '@tanstack/react-router'

import { InvitationCampaignAdmin } from '@/features/invitation/admin'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/invitation-campaigns/')({
  beforeLoad: () => {
    const u = useAuthStore.getState().auth.user
    if (!u || u.role < ROLE.ADMIN) throw redirect({ to: '/403' })
  },
  component: InvitationCampaignAdmin,
})

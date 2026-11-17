import { createFileRoute } from '@tanstack/react-router'

import { PersonalProfile } from '@/features/personal-profile'

export const Route = createFileRoute('/_authenticated/personal-profile/')({
  component: PersonalProfile,
})

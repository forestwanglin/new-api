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
  AgreementConsent,
  type AgreementKind,
} from '@/features/legal/agreement-consent'

import type { SystemStatus } from '../types'

interface LegalConsentProps {
  status: SystemStatus | null
  checked: boolean
  onCheckedChange: (nextValue: boolean) => void
  className?: string
}

export function LegalConsent(props: LegalConsentProps) {
  const documents: AgreementKind[] = []
  if (props.status?.user_agreement_enabled) documents.push('user')
  if (props.status?.privacy_policy_enabled) documents.push('privacy')
  return (
    <AgreementConsent
      documents={documents}
      checked={props.checked}
      onCheckedChange={props.onCheckedChange}
      className={props.className}
    />
  )
}

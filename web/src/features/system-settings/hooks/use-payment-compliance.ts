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
import { getOptionValue, useSystemOptions } from './use-system-options'

const CURRENT_COMPLIANCE_TERMS_VERSION = 'v1'

export function usePaymentCompliance() {
  const { data } = useSystemOptions()
  const complianceOptions = getOptionValue(data?.data, {
    'payment_setting.compliance_confirmed': false,
    'payment_setting.compliance_terms_version': '',
  })
  const complianceConfirmed =
    complianceOptions['payment_setting.compliance_confirmed'] &&
    complianceOptions['payment_setting.compliance_terms_version'] ===
      CURRENT_COMPLIANCE_TERMS_VERSION
  return complianceConfirmed
}

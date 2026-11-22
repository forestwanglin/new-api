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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'

import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'

import {
  SIDEBAR_MODULES_DEFAULT,
  serializeSidebarModulesAdmin,
} from '../config'
import { SidebarModulesSection } from '../sidebar-modules-section'

it('uses the points management label without changing the sidebar module setting', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsPageProvider actionsContainer={null}>
        <SidebarModulesSection
          config={SIDEBAR_MODULES_DEFAULT}
          initialSerialized={serializeSidebarModulesAdmin(
            SIDEBAR_MODULES_DEFAULT
          )}
        />
      </SettingsPageProvider>
    </QueryClientProvider>
  )

  expect(screen.getByRole('switch', { name: 'Point types' })).toBeVisible()
})

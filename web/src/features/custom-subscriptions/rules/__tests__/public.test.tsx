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
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { PublicSubscriptionRules } from '../public-rules'

function renderPublic() {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
 return render(<QueryClientProvider client={client}><PublicSubscriptionRules /></QueryClientProvider>)
}
it('renders configured text and highlights from the public API', async () => {
 vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: { items: [{ id: '1', title: 'Managed rule', rule_key: 'managed', content: { blocks: [{ type: 'paragraph', children: [{ text: 'Managed highlight', style: { color: '#0052d9', fontWeight: 700 } }] }] } }] } } })
 renderPublic()
 expect(await screen.findByText('Managed rule')).toBeVisible()
 expect(screen.getByText('Managed highlight')).toHaveStyle({ color: '#0052d9', fontWeight: '700' })
})
it('shows an empty managed result without restoring old bundled rules', async () => {
 vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: { items: [] } } })
 renderPublic()
 expect(await screen.findByText('No subscription rules')).toBeVisible()
 expect(screen.queryByText(/月付价格/)).not.toBeInTheDocument()
})
it('shows retryable failure and loads configured rules after retry', async () => {
 const user = userEvent.setup()
 vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('Rules unavailable')).mockResolvedValue({ data: { success: true, data: { items: [] } } })
 renderPublic()
 expect(await screen.findByText('Rules unavailable')).toBeVisible()
 await user.click(screen.getByRole('button', { name: 'Retry' }))
 expect(await screen.findByText('No subscription rules')).toBeVisible()
})

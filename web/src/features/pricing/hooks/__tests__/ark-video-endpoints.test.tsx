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
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'

import { usePricingData } from '../use-pricing-data'

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ status: { price: 1, usd_exchange_rate: 7.3 } }),
}))

function Probe() {
  const { models } = usePricingData()
  return (
    <div>
      {models.map((model) => (
        <p key={model.model_name}>
          {model.model_name}:{(model.supported_endpoint_types ?? []).join(',')}
        </p>
      ))}
    </div>
  )
}

test('older Doubao video metadata appears in Video filters and keeps chat models unchanged', () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const model = (name: string) => ({
    model_name: name,
    quota_type: 0,
    model_ratio: 18.5,
    enable_groups: [],
    supported_endpoint_types: ['openai'],
  })
  client.setQueryData(['pricing'], {
    data: [
      model('doubao-seedance-2-0-fast-260128'),
      model('doubao-seedance-2-0-mini-260615'),
      model('gpt-5'),
    ],
    vendors: [],
    group_ratio: {},
  })
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  )
  expect(html).toContain('doubao-seedance-2-0-fast-260128:openai-video')
  expect(html).toContain('doubao-seedance-2-0-mini-260615:openai-video')
  expect(html).toContain('gpt-5:openai')
  client.clear()
})

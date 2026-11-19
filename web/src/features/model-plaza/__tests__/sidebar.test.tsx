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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { ModelSidebar } from '../model-sidebar'

it('renders domestic and overseas as headings without counts while vendors remain selectable', async () => {
  const onChange = vi.fn()
  render(
    <ModelSidebar
      count={5}
      filter={{ category: null, vendorId: null }}
      onChange={onChange}
      groups={[
        {
          id: 'domestic',
          label: 'Domestic Models',
          count: 2,
          vendors: [{ id: 'qwen', name: 'Qwen', count: 2 }],
        },
        {
          id: 'overseas',
          label: 'Overseas Models',
          count: 3,
          vendors: [{ id: 'openai', name: 'OpenAI', count: 3 }],
        },
      ]}
    />
  )
  for (const name of ['Domestic Models', 'Overseas Models']) {
    expect(screen.getByRole('heading', { name })).toHaveTextContent(name)
    expect(
      screen.queryByRole('button', { name: new RegExp(name) })
    ).not.toBeInTheDocument()
  }
  await userEvent.click(screen.getByRole('button', { name: /OpenAI\s*3/ }))
  expect(onChange).toHaveBeenCalledWith({
    category: 'overseas',
    vendorId: 'openai',
  })
})

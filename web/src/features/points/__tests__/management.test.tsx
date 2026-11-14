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
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { Points } from '..'
import { pointsQueryKeys } from '../api'
import { PointRuleForm } from '../components/point-rule-form'
import { PointRulesDialog } from '../components/point-rules-dialog'
import type { PointModelRule, PointType } from '../types'

const pointType: PointType = {
  id: 3,
  code: 'DS',
  name: 'Future points',
  consume_priority: 20,
  created_at: 0,
  updated_at: 0,
}
const rule: PointModelRule = {
  id: 7,
  point_type_id: 3,
  match_type: 'PATTERN',
  match_value: 'Future/*',
  enabled: false,
  created_at: 0,
  updated_at: 0,
}

function setup(element: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
  return client
}

describe('points management', () => {
  it('renders future database types with read-only metadata and a model management action', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: [pointType] },
    })
    setup(<Points />)
    expect(await screen.findByText('DS')).toBeVisible()
    expect(screen.getByText('Future points')).toBeVisible()
    expect(screen.getByText('20')).toBeVisible()
    expect(screen.getByText(/Higher values first/)).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Manage model rules' })
    ).toBeEnabled()
    expect(
      screen.queryByRole('button', {
        name: /add point type|delete point type|edit point type/i,
      })
    ).not.toBeInTheDocument()
  })

  it('shows an explicit empty type state', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: [] },
    })
    setup(<Points />)
    expect(await screen.findByText('No point types configured')).toBeVisible()
  })

  it('shows loading, failed query retry and recovered types', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({ data: { success: true, data: [pointType] } })
    setup(<Points />)
    expect(screen.getByText('Loading...')).toBeVisible()
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('DS')).toBeVisible()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid input before sending a create request', async () => {
    const post = vi.spyOn(api, 'post')
    setup(<PointRuleForm typeId={3} rule={null} onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText(
        'Use 1–255 characters without surrounding whitespace or control characters.'
      )
    ).toBeVisible()
    expect(
      screen.getByRole('textbox', { name: 'Model name or pattern' })
    ).toHaveAttribute('aria-invalid', 'true')
    expect(post).not.toHaveBeenCalled()
  })

  it('creates a rule and invalidates only the selected type rules', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true, data: {} } })
    const onClose = vi.fn()
    const client = setup(
      <PointRuleForm typeId={3} rule={null} onClose={onClose} />
    )
    client.setQueryData(pointsQueryKeys.rules(3), [])
    client.setQueryData(pointsQueryKeys.rules(4), [])
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Model name or pattern' }),
      { target: { value: 'Future/Model' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(post).toHaveBeenCalledWith('/api/points/types/3/rules', {
      match_type: 'EXACT',
      match_value: 'Future/Model',
      enabled: true,
    })
    expect(client.getQueryState(pointsQueryKeys.rules(3))?.isInvalidated).toBe(
      true
    )
    expect(client.getQueryState(pointsQueryKeys.rules(4))?.isInvalidated).toBe(
      false
    )
  })

  it('preserves disabled rule edits and retains the form after server rejection', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: { success: false, message: 'Duplicate rule' },
    })
    const success = vi.spyOn(toast, 'success')
    const onClose = vi.fn()
    setup(<PointRuleForm typeId={3} rule={rule} onClose={onClose} />)
    expect(screen.getByRole('switch', { name: 'Enabled' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Duplicate rule')
    expect(put).toHaveBeenCalledWith('/api/points/types/3/rules/7', {
      match_type: 'PATTERN',
      match_value: 'Future/*',
      enabled: false,
    })
    expect(screen.getByRole('textbox')).toHaveValue('Future/*')
    expect(onClose).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
  })

  it('requires confirmation to delete and reloads the selected type rules', async () => {
    let rules = [rule]
    const get = vi.spyOn(api, 'get').mockImplementation(async () => ({
      data: { success: true, data: rules },
    }))
    const remove = vi.spyOn(api, 'delete').mockImplementation(async () => {
      rules = []
      return { data: { success: true } }
    })
    setup(<PointRulesDialog pointType={pointType} onClose={() => undefined} />)
    expect(await screen.findByText('Future/*')).toBeVisible()
    expect(screen.getByText('Disabled')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Delete model rule' })
    )
    const confirmation = await screen.findByRole('alertdialog')
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(
      within(confirmation).getByRole('button', { name: 'Delete' })
    )
    expect(await screen.findByText('No model rules configured')).toBeVisible()
    expect(remove).toHaveBeenCalledWith('/api/points/types/3/rules/7')
    expect(get).toHaveBeenCalledTimes(2)
  })
})

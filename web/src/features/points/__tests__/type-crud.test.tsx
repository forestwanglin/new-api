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
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { Points } from '..'
import { pointsQueryKeys } from '../api'
import type { PointType } from '../types'

const general: PointType = {
  id: 1,
  code: 'GENERAL',
  name: 'General credits',
  consume_priority: 100,
  config_version: 7,
  created_at: 0,
  updated_at: 0,
}
const custom: PointType = {
  id: 3,
  code: 'GPT',
  name: 'Research credits',
  consume_priority: 10,
  config_version: 4,
  created_at: 0,
  updated_at: 0,
}
function setup(types: PointType[] = [general, custom]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  vi.spyOn(api, 'get').mockImplementation(async () => ({
    data: { success: true, data: [...types] },
  }))
  render(
    <QueryClientProvider client={client}>
      <Points />
    </QueryClientProvider>
  )
  return { client, types }
}

describe('point type CRUD', () => {
  it('creates a type with its code, name and priority and refreshes the list', async () => {
    const { client, types } = setup()
    client.setQueryData(pointsQueryKeys.catalog, [])
    const post = vi.spyOn(api, 'post').mockImplementation(async () => {
      const created = {
        ...custom,
        id: 9,
        code: 'IMAGE_2',
        name: 'Image credits',
        consume_priority: -5,
      }
      types.push(created)
      return { data: { success: true, data: created } }
    })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Add point type' })
    )
    const dialog = screen.getByRole('dialog', { name: 'Add point type' })
    fireEvent.change(
      within(dialog).getByRole('textbox', { name: 'Point type code' }),
      { target: { value: 'IMAGE_2' } }
    )
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Image credits' },
    })
    fireEvent.change(
      within(dialog).getByRole('spinbutton', { name: 'Consumption priority' }),
      { target: { value: '-5' } }
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('IMAGE_2')).toBeVisible()
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(post).toHaveBeenCalledWith('/api/points/types', {
      code: 'IMAGE_2',
      name: 'Image credits',
      consume_priority: -5,
    })
    expect(client.getQueryState(pointsQueryKeys.catalog)?.isInvalidated).toBe(
      true
    )
  })

  it('rejects invalid code and non-integer priority without submitting and keeps entered values', async () => {
    setup()
    const post = vi.spyOn(api, 'post')
    fireEvent.click(
      await screen.findByRole('button', { name: 'Add point type' })
    )
    const code = screen.getByRole('textbox', { name: 'Point type code' })
    const priority = screen.getByRole('spinbutton', {
      name: 'Consumption priority',
    })
    fireEvent.change(code, { target: { value: 'bad-code' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Draft name' },
    })
    fireEvent.change(priority, { target: { value: '1.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(code).toHaveAttribute('aria-invalid', 'true'))
    expect(priority).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(
      'Draft name'
    )
    expect(post).not.toHaveBeenCalled()
  })

  it('edits name and priority without changing the immutable code', async () => {
    setup()
    const patch = vi
      .spyOn(api, 'patch')
      .mockResolvedValue({ data: { success: true, data: custom } })
    const row = await screen.findByRole('row', { name: /Research credits/ })
    fireEvent.click(
      within(row).getByRole('button', { name: 'Edit point type' })
    )
    expect(
      screen.getByRole('textbox', { name: 'Point type code' })
    ).toHaveValue('GPT')
    expect(
      screen.getByRole('textbox', { name: 'Point type code' })
    ).toHaveAttribute('readonly')
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Renamed credits' },
    })
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'Consumption priority' }),
      { target: { value: '25' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(patch).toHaveBeenCalledWith('/api/points/types/3', {
      name: 'Renamed credits',
      consume_priority: 25,
      config_version: 4,
    })
  })

  it('preserves a create draft after a duplicate-code rejection', async () => {
    setup()
    vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: false, message: 'Point type code already exists' },
    })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Add point type' })
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Point type code' }), {
      target: { value: 'GPT' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Draft credits' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Point type code already exists'
    )
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(
      'Draft credits'
    )
    expect(
      screen.getByRole('textbox', { name: 'Point type code' })
    ).toHaveValue('GPT')
  })

  it('cancels deletion without a request, then confirms versioned deletion and refreshes the list', async () => {
    const { types } = setup()
    const remove = vi.spyOn(api, 'delete').mockImplementation(async () => {
      types.splice(
        types.findIndex((type) => type.id === 3),
        1
      )
      return { data: { success: true, data: null } }
    })
    const row = await screen.findByRole('row', { name: /Research credits/ })
    fireEvent.click(
      within(row).getByRole('button', { name: 'Delete point type' })
    )
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Research credits'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(
      within(row).getByRole('button', { name: 'Delete point type' })
    )
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete point type',
      })
    )
    await waitFor(() =>
      expect(screen.queryByText('Research credits')).not.toBeInTheDocument()
    )
    expect(remove).toHaveBeenCalledWith('/api/points/types/3', {
      data: { config_version: 4 },
    })
  })

  it.each([
    'Point type is used by user accounts',
    'Point type is used by subscription orders',
    'Point type is used by model billing history',
  ])(
    'keeps the type and shows the specific deletion rejection: %s',
    async (message) => {
      setup()
      vi.spyOn(api, 'delete').mockResolvedValue({
        data: { success: false, message },
      })
      const row = await screen.findByRole('row', { name: /Research credits/ })
      fireEvent.click(
        within(row).getByRole('button', { name: 'Delete point type' })
      )
      const dialog = screen.getByRole('alertdialog')
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Delete point type' })
      )
      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(dialog).toBeVisible()
      expect(screen.getAllByText('Research credits')).toHaveLength(2)
    }
  )

  it('protects GENERAL from deletion and explains why while keeping edit available', async () => {
    setup()
    const row = await screen.findByRole('row', { name: /General credits/ })
    const remove = within(row).getByRole('button', {
      name: 'Delete point type',
    })
    expect(remove).toBeDisabled()
    expect(remove).toHaveAccessibleDescription(
      'GENERAL is a system point type and cannot be deleted'
    )
    expect(
      within(row).getByRole('button', { name: 'Edit point type' })
    ).toBeEnabled()
  })

  it('prevents repeated create submissions while the request is pending', async () => {
    setup()
    let finish!: () => void
    vi.spyOn(api, 'post').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ data: { success: true, data: custom } })
        })
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Add point type' })
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Point type code' }), {
      target: { value: 'IMAGE' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Image credits' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(
      screen.getByRole('textbox', { name: 'Point type code' })
    ).toBeDisabled()
    await act(async () => finish())
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
  })
})

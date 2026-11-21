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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LogPointsDisplay } from '@/features/usage-logs/components/log-points-display'
import { UserPointsCell } from '@/features/users/components/user-points-cell'
import { api } from '@/lib/api'

import { pointsQueryKeys } from '../api'
import { PointPolicyEditor } from '../components/point-policy-editor'
import { PointRenameDialog } from '../components/point-rename-dialog'
import { PointNamesProvider } from '../point-names-provider'
import type { PointPolicyConfig } from '../types'

const config: PointPolicyConfig = {
  config_version: 7,
  policy: {
    version: 1,
    operator: 'AND',
    groups: [
      {
        operator: 'OR',
        enabled: true,
        conditions: [
          {
            kind: 'MODEL',
            match_type: 'EXACT',
            match_value: 'model-a',
            enabled: true,
          },
        ],
      },
      {
        operator: 'OR',
        enabled: true,
        conditions: [{ kind: 'CHANNEL', channel_id: '12', enabled: true }],
      },
    ],
  },
}
function setup(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(<QueryClientProvider client={client}>{children}</QueryClientProvider>)
  return client
}
describe('grouped point rule editor', () => {
  it('saves both model and channel groups with their independent operators and version', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: { success: true, data: { ...config, config_version: 8 } },
    })
    const onClose = vi.fn()
    setup(
      <PointPolicyEditor
        typeId={3}
        config={config}
        channels={[{ id: '12', name: 'Primary' }]}
        onClose={onClose}
        onPendingChange={() => undefined}
      />
    )
    expect(
      screen.getByRole('combobox', { name: 'Relationship between groups' })
    ).toHaveTextContent('AND')
    expect(screen.getByRole('combobox', { name: 'Channel' })).toHaveValue(
      'Primary (#12)'
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Model name or pattern' }),
      { target: { value: 'model-b' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(put).toHaveBeenCalledWith('/api/points/types/3/policy', {
      policy: {
        ...config.policy,
        groups: [
          {
            ...config.policy.groups[0],
            conditions: [
              {
                kind: 'MODEL',
                match_type: 'EXACT',
                match_value: 'model-b',
                enabled: true,
              },
            ],
          },
          config.policy.groups[1],
        ],
      },
      config_version: 7,
    })
  })
  it('retains an edited draft and missing channel selection after a stale-version rejection', async () => {
    vi.spyOn(api, 'put').mockResolvedValue({
      data: {
        success: false,
        message: 'Point configuration changed. Reload and try again.',
      },
    })
    const onClose = vi.fn()
    setup(
      <PointPolicyEditor
        typeId={3}
        config={config}
        channels={[]}
        onClose={onClose}
        onPendingChange={() => undefined}
      />
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Model name or pattern' }),
      { target: { value: 'unsaved-model' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Point configuration changed. Reload and try again.'
    )
    expect(
      screen.getByRole('textbox', { name: 'Model name or pattern' })
    ).toHaveValue('unsaved-model')
    expect(screen.getByRole('combobox', { name: 'Channel' })).toHaveValue(
      'Unavailable channel (#12)'
    )
    expect(onClose).not.toHaveBeenCalled()
  })
  it('rejects enabled groups with no enabled conditions before a request', async () => {
    const put = vi.spyOn(api, 'put')
    setup(
      <PointPolicyEditor
        typeId={3}
        config={config}
        channels={[]}
        onClose={() => undefined}
        onPendingChange={() => undefined}
      />
    )
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Remove condition' })[0]
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check each condition'
    )
    expect(put).not.toHaveBeenCalled()
  })
})
describe('point editor concurrent refresh', () => {
  it('keeps the draft base version when policy props refresh, so a stale save conflicts', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: {
        success: false,
        message: 'Point configuration changed. Reload and try again.',
      },
    })
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const onClose = vi.fn()
    const content = (value: PointPolicyConfig) => (
      <QueryClientProvider client={client}>
        <PointPolicyEditor
          typeId={3}
          config={value}
          channels={[]}
          onClose={onClose}
          onPendingChange={() => undefined}
        />
      </QueryClientProvider>
    )
    const view = render(content(config))
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Model name or pattern' }),
      { target: { value: 'my-draft' } }
    )
    view.rerender(content({ ...config, config_version: 8 }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Point configuration changed.'
    )
    expect(put).toHaveBeenCalledWith(
      '/api/points/types/3/policy',
      expect.objectContaining({ config_version: 7 })
    )
    expect(
      screen.getByRole('textbox', { name: 'Model name or pattern' })
    ).toHaveValue('my-draft')
    expect(onClose).not.toHaveBeenCalled()
  })
  it('keeps the rename base version when the type directory refreshes', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({
      data: {
        success: false,
        message: 'Point configuration changed. Reload and try again.',
      },
    })
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const pointType = {
      id: 1,
      code: 'GENERAL',
      name: 'Old name',
      config_version: 7,
      consume_priority: 100,
      created_at: 0,
      updated_at: 0,
    }
    const onClose = vi.fn()
    const content = (version: number) => (
      <QueryClientProvider client={client}>
        <PointRenameDialog
          pointType={{ ...pointType, config_version: version }}
          onClose={onClose}
        />
      </QueryClientProvider>
    )
    const view = render(content(7))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'My draft name' },
    })
    view.rerender(content(8))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Point configuration changed.'
    )
    expect(patch).toHaveBeenCalledWith('/api/points/types/1', {
      name: 'My draft name',
      config_version: 7,
    })
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(
      'My draft name'
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})
describe('point rename and directory presentation', () => {
  it('rejects an invalid name, then saves the versioned name and refreshes the catalog', async () => {
    const patch = vi
      .spyOn(api, 'patch')
      .mockResolvedValue({ data: { success: true, data: {} } })
    const onClose = vi.fn()
    const client = setup(
      <PointRenameDialog
        pointType={{
          id: 1,
          code: 'GENERAL',
          name: 'Old name',
          config_version: 7,
          consume_priority: 100,
          created_at: 0,
          updated_at: 0,
        }}
        onClose={onClose}
      />
    )
    client.setQueryData(pointsQueryKeys.catalog, [
      { id: '1', code: 'GENERAL', name: 'Old name' },
    ])
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: ' bad ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText(
        'Use 1–64 characters without surrounding whitespace or control characters.'
      )
    ).toBeVisible()
    expect(patch).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Current credits' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(patch).toHaveBeenCalledWith('/api/points/types/1', {
      name: 'Current credits',
      config_version: 7,
    })
    expect(client.getQueryState(pointsQueryKeys.catalog)?.isInvalidated).toBe(
      true
    )
  })
  it('uses one catalog for current user and historical billing labels and reacts to rename without mutating history', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: [{ id: '1', code: 'GENERAL', name: 'Current credits' }],
      },
    })
    const item = {
      point_type_id: '1',
      code: 'GENERAL',
      name: 'Historical credits',
      points: '9007199254740993',
    }
    const client = setup(
      <PointNamesProvider>
        <UserPointsCell
          balances={[
            {
              code: 'GENERAL',
              name: 'Old user label',
              available_points: '9007199254740993',
              frozen_points: '0',
            },
          ]}
        />
        <LogPointsDisplay
          billing={{
            version: 1,
            call_id: 'call',
            event_id: 'event',
            status: 'committed',
            total_points: item.points,
            items: [item],
          }}
        />
      </PointNamesProvider>
    )
    await waitFor(() =>
      expect(screen.getAllByText('Current credits')).toHaveLength(2)
    )
    expect(screen.queryByText('Historical credits')).not.toBeInTheDocument()
    expect(screen.getAllByText('9,007,199,254,740,993')).toHaveLength(2)
    expect(get).toHaveBeenCalledTimes(1)
    await act(async () => {
      client.setQueryData(pointsQueryKeys.catalog, [
        { id: '1', code: 'GENERAL', name: 'Renamed again' },
      ])
    })
    await waitFor(() =>
      expect(screen.getAllByText('Renamed again')).toHaveLength(2)
    )
    expect(item.name).toBe('Historical credits')
  })
})

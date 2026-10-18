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
import { describe, expect, test } from 'vitest'

import type { ApiKey } from '@/features/keys/types'
import type { PricingModel } from '@/features/pricing/types'

import {
  buildCurlCommand,
  buildPythonSample,
  formatDisplayKey,
  normalizeEndpoint,
  pickFirstKey,
  selectModelsForGroup,
  toBaseUrl,
} from '../access-guide'

function makeKey(id: number, overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id,
    name: `key-${id}`,
    key: `masked-${id}`,
    status: 1,
    remain_quota: 0,
    used_quota: 0,
    unlimited_quota: true,
    expired_time: -1,
    created_time: 0,
    accessed_time: 0,
    group: 'default',
    auto_groups: null,
    cross_group_retry: false,
    model_limits_enabled: false,
    model_limits: '',
    allow_ips: '',
    allow_user_quota_query: false,
    ...overrides,
  }
}

function makeModel(modelName: string, enableGroups: string[]): PricingModel {
  return {
    id: modelName.length,
    model_name: modelName,
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 2,
    enable_groups: enableGroups,
  } as PricingModel
}

describe('normalizeEndpoint', () => {
  test('falls back to the current origin when no api info is configured', () => {
    expect(normalizeEndpoint(undefined)).toBe(
      `${window.location.origin}/v1/chat/completions`
    )
    expect(normalizeEndpoint('   ')).toBe(
      `${window.location.origin}/v1/chat/completions`
    )
  })

  test('appends the chat completions path to a base /v1 url', () => {
    expect(normalizeEndpoint('https://api.example.com/v1')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
    expect(normalizeEndpoint('https://api.example.com/v1/')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
  })

  test('keeps a full chat completions url unchanged', () => {
    expect(
      normalizeEndpoint('https://api.example.com/v1/chat/completions')
    ).toBe('https://api.example.com/v1/chat/completions')
  })

  test('assumes a bare host is a v1 gateway', () => {
    expect(normalizeEndpoint('https://api.example.com')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
  })
})

describe('toBaseUrl', () => {
  test('strips the chat completions suffix', () => {
    expect(toBaseUrl('https://api.example.com/v1/chat/completions')).toBe(
      'https://api.example.com/v1'
    )
  })

  test('leaves a url without the suffix untouched', () => {
    expect(toBaseUrl('https://api.example.com/v1')).toBe(
      'https://api.example.com/v1'
    )
  })
})

describe('formatDisplayKey', () => {
  test('falls back to a placeholder when no masked key is available', () => {
    expect(formatDisplayKey(undefined)).toBe('sk-...')
  })

  test('keeps short masked keys readable', () => {
    expect(formatDisplayKey('masked')).toBe('sk-masked')
  })

  test('truncates long masked keys in the middle', () => {
    expect(formatDisplayKey('abcd**********wxyz')).toBe('sk-abcd...wxyz')
  })
})

describe('pickFirstKey', () => {
  test('returns null for an empty list', () => {
    expect(pickFirstKey([])).toBeNull()
  })

  test('returns the first key of the list', () => {
    const first = makeKey(2)
    const second = makeKey(1)
    expect(pickFirstKey([first, second])).toBe(first)
  })
})

describe('selectModelsForGroup', () => {
  const userModels = ['gpt-4o-mini', 'deepseek-chat']
  const pricingModels = [
    makeModel('gpt-4o-mini', ['default', 'vip']),
    makeModel('deepseek-chat', ['default']),
    makeModel('not-for-user', ['default']),
  ]

  test('only returns models the user can access in the selected group', () => {
    expect(
      selectModelsForGroup(userModels, pricingModels, 'vip').map(
        (model) => model.model_name
      )
    ).toEqual(['gpt-4o-mini'])
    expect(
      selectModelsForGroup(userModels, pricingModels, 'default').map(
        (model) => model.model_name
      )
    ).toEqual(['gpt-4o-mini', 'deepseek-chat'])
  })

  test('returns nothing when the group has no user-available model', () => {
    expect(selectModelsForGroup(userModels, pricingModels, 'missing')).toEqual(
      []
    )
  })

  test('degrades to all user models for empty and auto groups', () => {
    const expected = ['gpt-4o-mini', 'deepseek-chat']
    expect(
      selectModelsForGroup(userModels, pricingModels, '').map(
        (model) => model.model_name
      )
    ).toEqual(expected)
    expect(
      selectModelsForGroup(userModels, pricingModels, 'auto').map(
        (model) => model.model_name
      )
    ).toEqual(expected)
  })
})

describe('code samples', () => {
  const args = {
    baseUrl: 'https://api.example.com/v1',
    endpoint: 'https://api.example.com/v1/chat/completions',
    apiKey: 'sk-abcd...wxyz',
    model: 'gpt-4o-mini',
  }

  test('builds a curl command with endpoint, key and model', () => {
    const command = buildCurlCommand(args)
    expect(command).toContain(args.endpoint)
    expect(command).toContain(`Bearer ${args.apiKey}`)
    expect(command).toContain(`"model":"${args.model}"`)
  })

  test('builds a python sample with base url, key and model', () => {
    const sample = buildPythonSample(args)
    expect(sample).toContain(`base_url="${args.baseUrl}"`)
    expect(sample).toContain(`api_key="${args.apiKey}"`)
    expect(sample).toContain(`model="${args.model}"`)
  })

  test('falls back to a placeholder model when none is selected', () => {
    expect(buildCurlCommand({ ...args, model: '' })).toContain(
      '"model":"gpt-4o-mini"'
    )
    expect(buildPythonSample({ ...args, model: '' })).toContain(
      'model="gpt-4o-mini"'
    )
  })
})

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
import { expect, test } from 'vitest'

import { buildArkVideoSample } from '../ark-video-examples'

test('copyable curl uses video creation with explicit duration, resolution and false audio', () => {
  const result = buildArkVideoSample('curl', {
    baseUrl: 'https://www.example.com',
    endpointPath: '/v1/videos',
    apiKeyEnv: 'NEW_API_KEY',
    modelName: 'doubao-seedance-2-0-mini-260615',
  })
  expect(result).toContain('https://www.example.com/v1/videos')
  const body = JSON.parse(result.split("-d '")[1].slice(0, -1))
  expect(body.model).toBe('doubao-seedance-2-0-mini-260615')
  expect(body.seconds).toBe('4')
  expect(body.metadata.resolution).toBe('720p')
  expect(body.metadata.generate_audio).toBe(false)
  expect(body.messages).toBeUndefined()
})

test('Python preserves JSON false through json.loads instead of invalid Python syntax', () => {
  const result = buildArkVideoSample('python', {
    baseUrl: 'https://www.example.com',
    endpointPath: '/v1/videos',
    apiKeyEnv: 'NEW_API_KEY',
    modelName: 'doubao-seedance-2-0-fast-260128',
  })
  expect(result).toContain('json.loads(r"""')
  expect(result).toContain('response.raise_for_status()')
  expect(result).not.toContain('chat.completions')
})

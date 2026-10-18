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
import type { ApiKey } from '@/features/keys/types'
import type { PricingModel } from '@/features/pricing/types'

const DEFAULT_ENDPOINT_SUFFIX = '/v1/chat/completions'
const MASK_VISIBLE_PREFIX = 7
const MASK_VISIBLE_SUFFIX = 4
const MASK_MIN_LENGTH = MASK_VISIBLE_PREFIX + MASK_VISIBLE_SUFFIX + 1

/**
 * The origin of the current console. Used as fallback when the backend does not
 * advertise an `api_info` URL (self-hosted / single-domain deployments).
 */
export function getCurrentOrigin(): string {
  if (typeof window === 'undefined') return ''
  return window.location.origin
}

/**
 * Derive the chat completions endpoint from an advertised base URL.
 */
export function normalizeEndpoint(sourceUrl?: string): string {
  const fallback = `${getCurrentOrigin()}${DEFAULT_ENDPOINT_SUFFIX}`
  const trimmed = sourceUrl?.trim()
  if (!trimmed) return fallback

  const withoutTrailingSlash = trimmed.replace(/\/+$/, '')
  if (withoutTrailingSlash.endsWith('/v1/chat/completions')) {
    return withoutTrailingSlash
  }
  if (withoutTrailingSlash.endsWith('/v1')) {
    return `${withoutTrailingSlash}/chat/completions`
  }
  return `${withoutTrailingSlash}/v1/chat/completions`
}

/**
 * OpenAI-compatible base URL (`…/v1`) derived from a chat completions endpoint.
 */
export function toBaseUrl(chatEndpoint: string): string {
  return chatEndpoint.replace(/\/chat\/completions\/?$/, '')
}

/**
 * Render the masked key returned by `GET /api/token/` as an OpenAI-looking
 * display value. The full value is never present on the client until it is
 * explicitly requested through `fetchTokenKey`.
 */
export function formatDisplayKey(maskedKey?: string): string {
  if (!maskedKey) return 'sk-...'
  const key = `sk-${maskedKey}`
  if (key.length <= MASK_MIN_LENGTH) return key
  return `${key.slice(0, MASK_VISIBLE_PREFIX)}...${key.slice(-MASK_VISIBLE_SUFFIX)}`
}

/**
 * The overview card always presents the first token of the user's list. The
 * backend (`model.GetAllUserTokens`) orders by `id desc`, so this is the most
 * recently created key — the same one shown at the top of the API keys page.
 */
export function pickFirstKey(keys: ApiKey[]): ApiKey | null {
  return keys[0] ?? null
}

/**
 * Models the user can actually call under the given token group: the
 * intersection of the user's available models and the pricing entries enabled
 * for that group. Empty / `auto` groups cannot be resolved to a single group,
 * so they degrade to every user-available model.
 */
export function selectModelsForGroup(
  userModels: string[],
  pricingModels: PricingModel[],
  group?: string
): PricingModel[] {
  const available = new Set(userModels)
  const candidates = pricingModels.filter((model) =>
    available.has(model.model_name)
  )
  const normalizedGroup = group?.trim() ?? ''
  if (!normalizedGroup || normalizedGroup === 'auto') return candidates

  return candidates.filter((model) =>
    (model.enable_groups ?? []).includes(normalizedGroup)
  )
}

export interface CodeSampleArgs {
  baseUrl: string
  endpoint: string
  apiKey: string
  model: string
}

function resolveModel(model: string): string {
  return model || 'gpt-4o-mini'
}

export function buildCurlCommand(args: CodeSampleArgs): string {
  return [
    `curl ${args.endpoint} \\`,
    '  -H "Content-Type: application/json" \\',
    `  -H "Authorization: Bearer ${args.apiKey}" \\`,
    `  -d '{"model":"${resolveModel(args.model)}","messages":[{"role":"user","content":"Say hello in one sentence."}]}'`,
  ].join('\n')
}

export function buildPythonSample(args: CodeSampleArgs): string {
  return [
    'from openai import OpenAI',
    '',
    'client = OpenAI(',
    `    base_url="${args.baseUrl}",`,
    `    api_key="${args.apiKey}",  # 也可放环境变量`,
    ')',
    '',
    'resp = client.chat.completions.create(',
    `    model="${resolveModel(args.model)}",`,
    '    messages=[{"role": "user", "content": "Say hello in one sentence."}],',
    ')',
    'print(resp.choices[0].message.content)',
  ].join('\n')
}

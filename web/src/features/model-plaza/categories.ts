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
import type { PricingModel } from '@/features/pricing/types'

export type ModelCategory = 'domestic' | 'overseas' | 'other'

// Display-only vendor ownership. Extend aliases when onboarding a new vendor;
// unmatched names stay in Other Models rather than guessing from model names.
const DOMESTIC_VENDORS = new Set([
  'deepseek',
  '深度求索',
  'zhipu',
  'zhipuai',
  '智谱',
  '智谱ai',
  '智谱清言',
  'alibaba',
  'aliyun',
  'qwen',
  '阿里巴巴',
  '阿里云',
  '通义千问',
  'moonshot',
  'moonshotai',
  'kimi',
  '月之暗面',
  'minimax',
  '稀宇科技',
  'bytedance',
  'doubao',
  '字节跳动',
  '字节系列',
  '豆包',
  '火山引擎',
  'baidu',
  'ernie',
  '百度',
  '文心一言',
  'tencent',
  'hunyuan',
  '腾讯',
  '腾讯混元',
  'huawei',
  '华为',
  'iflytek',
  '讯飞',
  '科大讯飞',
  '01ai',
  '零一万物',
  'baai',
  '智源',
  'stepfun',
  '阶跃星辰',
  '360',
  '快手',
  'kling',
  '即梦',
  'jimeng',
  'vidu',
  'sensetime',
  '商汤',
])

const OVERSEAS_VENDORS = new Set([
  'openai',
  'chatgpt',
  'anthropic',
  'claude',
  'google',
  'gemini',
  '谷歌',
  'xai',
  'grok',
  'meta',
  'metaai',
  'mistral',
  'mistralai',
  'cohere',
  'stability',
  'stabilityai',
  'ai21',
  'ai21labs',
  'perplexity',
  'nvidia',
  '英伟达',
  'microsoft',
  '微软',
  'cloudflare',
  'azure',
  'amazon',
  '亚马逊',
])

export function getModelCategory(model: PricingModel): ModelCategory {
  const vendor = model.vendor_name
    ?.trim()
    .toLowerCase()
    .replaceAll(/[\s_.-]+/g, '')
  if (vendor && DOMESTIC_VENDORS.has(vendor)) return 'domestic'
  if (vendor && OVERSEAS_VENDORS.has(vendor)) return 'overseas'
  return 'other'
}

export function getModelVendorKey(model: PricingModel): string {
  if (model.vendor_id !== undefined) return String(model.vendor_id)
  return `name:${model.vendor_name ?? ''}`
}

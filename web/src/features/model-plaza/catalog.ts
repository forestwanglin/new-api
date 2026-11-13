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
// Fork-owned model plaza catalog.
//
// This page is a curated, product-owned model list (design: c-dev/ZYY-AI-demo.html
// "#v-price") and is intentionally independent of the default pricing page
// (features/pricing), which keeps reading backend ratios unchanged.
//
// The per-token prices below are the marketing reference numbers of the plaza:
// keep them in sync with the backend billing configuration whenever the
// platform price or the vendor list changes.

/** 1 元 = 1,000 积分（与订阅/积分体系的换算基准一致）。 */
export const POINTS_PER_YUAN = 1000

/** 价格比较使用的固定 token 用量，不等同于中文字数。 */
export const ESTIMATE_INPUT_TOKENS = 2000
export const ESTIMATE_OUTPUT_TOKENS = 500

/** 海外系列；其余厂商归入国内模型。 */
export const OVERSEAS_VENDORS = ['ChatGPT', 'Claude', 'Gemini', 'Grok'] as const

export type TextModel = {
  id: string
  vendor: string
  /** 适合做什么 */
  useText: string
  /** 平台价：元 / 1K token（输入） */
  inputPer1k: number
  /** 平台价：元 / 1K token（输出） */
  outputPer1k: number
  /** 官网参考价：元 / 1K token（输入） */
  officialInputPer1k: number
  /** 官网参考价：元 / 1K token（输出） */
  officialOutputPer1k: number
}

export type VideoModel = {
  id: string
  name: string
  vendor: string
  status: string
  spec: string
  /** 平台价：元 / 30s 视频，null 表示价格待定 */
  pricePer30s: number | null
  /** 官网参考价：元 / 30s 视频，null 表示待确认 */
  officialPricePer30s: number | null
}

export const TEXT_MODELS: TextModel[] = [
  {
    id: 'deepseek-v4.1-flash',
    vendor: 'DeepSeek',
    useText: '日常对话、问答、总结',
    inputPer1k: 0.0014,
    outputPer1k: 0.0056,
    officialInputPer1k: 0.002,
    officialOutputPer1k: 0.008,
  },
  {
    id: 'deepseek-v4-flash',
    vendor: 'DeepSeek',
    useText: '日常对话、批量跑脚本',
    inputPer1k: 0.0021,
    outputPer1k: 0.0063,
    officialInputPer1k: 0.003,
    officialOutputPer1k: 0.009,
  },
  {
    id: 'deepseek-v4.1-flash-plus',
    vendor: 'DeepSeek',
    useText: '高频长对话、连续追问',
    inputPer1k: 0.0028,
    outputPer1k: 0.0084,
    officialInputPer1k: 0.004,
    officialOutputPer1k: 0.012,
  },
  {
    id: 'glm-5.3-flash',
    vendor: '智谱',
    useText: '中文写作、公文材料、总结',
    inputPer1k: 0.001,
    outputPer1k: 0.004,
    officialInputPer1k: 0.0015,
    officialOutputPer1k: 0.0062,
  },
  {
    id: 'glm-5.3-stable',
    vendor: '智谱',
    useText: '通用对话、中等推理',
    inputPer1k: 0.005,
    outputPer1k: 0.015,
    officialInputPer1k: 0.0071,
    officialOutputPer1k: 0.0214,
  },
  {
    id: 'deepseek-v4-pro',
    vendor: 'DeepSeek',
    useText: '复杂推理、写代码、改 bug',
    inputPer1k: 0.0063,
    outputPer1k: 0.0189,
    officialInputPer1k: 0.009,
    officialOutputPer1k: 0.027,
  },
  {
    id: 'DeepSeek-V4-Pro-plus',
    vendor: 'DeepSeek',
    useText: '最强推理、难题攻坚',
    inputPer1k: 0.009,
    outputPer1k: 0.027,
    officialInputPer1k: 0.0129,
    officialOutputPer1k: 0.0386,
  },
  {
    id: 'kimi-k3.1-pro',
    vendor: 'Moonshot',
    useText: '长文档、整库代码、超长对话',
    inputPer1k: 0.0077,
    outputPer1k: 0.0385,
    officialInputPer1k: 0.011,
    officialOutputPer1k: 0.055,
  },
  {
    id: 'kimi-k2.8-preview',
    vendor: 'Moonshot',
    useText: '尝鲜、测试新能力',
    inputPer1k: 0.006,
    outputPer1k: 0.03,
    officialInputPer1k: 0.008,
    officialOutputPer1k: 0.04,
  },
  {
    id: 'MiniMax-M3',
    vendor: 'MiniMax',
    useText: '传图、看截图、文档识别',
    inputPer1k: 0.0024,
    outputPer1k: 0.0096,
    officialInputPer1k: 0.0034,
    officialOutputPer1k: 0.0137,
  },
  {
    id: 'doubao-seed-evolving',
    vendor: '字节系列',
    useText: '国内节点、低延迟对话',
    inputPer1k: 0.0012,
    outputPer1k: 0.0036,
    officialInputPer1k: 0.0022,
    officialOutputPer1k: 0.0065,
  },
  {
    id: 'gpt-6.1-sol',
    vendor: 'ChatGPT',
    useText: '通用对话、英文与创作',
    inputPer1k: 0.011,
    outputPer1k: 0.044,
    officialInputPer1k: 0.015,
    officialOutputPer1k: 0.06,
  },
  {
    id: 'claude-sonnet-5',
    vendor: 'Claude',
    useText: '长文写作、代码审查',
    inputPer1k: 0.013,
    outputPer1k: 0.065,
    officialInputPer1k: 0.018,
    officialOutputPer1k: 0.09,
  },
  {
    id: 'gemini-4-pro',
    vendor: 'Gemini',
    useText: '多模态、超长上下文',
    inputPer1k: 0.009,
    outputPer1k: 0.036,
    officialInputPer1k: 0.0125,
    officialOutputPer1k: 0.05,
  },
  {
    id: 'grok-5',
    vendor: 'Grok',
    useText: '实时信息、开放问答',
    inputPer1k: 0.01,
    outputPer1k: 0.04,
    officialInputPer1k: 0.014,
    officialOutputPer1k: 0.055,
  },
]

/** 视频模型按视频时长计价，待规格与报价确认后才开放。 */
export const VIDEO_MODELS: VideoModel[] = [
  {
    id: 'seedance-2.0',
    name: 'Seedance 2.0',
    vendor: '字节系列',
    status: '待接入',
    spec: '分辨率、音频与生成时长待确认',
    pricePer30s: null,
    officialPricePer30s: null,
  },
  {
    id: 'seedance-2.5',
    name: 'Seedance 2.5',
    vendor: '字节系列',
    status: '待接入',
    spec: '分辨率、音频与生成时长待确认',
    pricePer30s: null,
    officialPricePer30s: null,
  },
]

export function isOverseas(model: TextModel): boolean {
  return (OVERSEAS_VENDORS as readonly string[]).includes(model.vendor)
}

/** 一次估算调用（固定输入/输出 token）的平台成本，单位元。 */
export function callCostYuan(model: TextModel): number {
  return (
    (ESTIMATE_INPUT_TOKENS / 1000) * model.inputPer1k +
    (ESTIMATE_OUTPUT_TOKENS / 1000) * model.outputPer1k
  )
}

/** 同样用量的官网参考成本，单位元。 */
export function officialCallCostYuan(model: TextModel): number {
  return (
    (ESTIMATE_INPUT_TOKENS / 1000) * model.officialInputPer1k +
    (ESTIMATE_OUTPUT_TOKENS / 1000) * model.officialOutputPer1k
  )
}

/** 每次调用实际扣减的积分：四舍五入到整数，最低 1 积分。 */
export function pointsPerCall(model: TextModel): number {
  return Math.max(1, Math.round(callCostYuan(model) * POINTS_PER_YUAN))
}

/** 我们 ￥1 能发约多少次（次数向下取整）。 */
export function callsPerYuan(model: TextModel): number {
  return Math.floor(POINTS_PER_YUAN / pointsPerCall(model))
}

/** 官网 ￥1 能发约多少次（次数向下取整）。 */
export function officialCallsPerYuan(model: TextModel): number {
  return Math.floor(1 / officialCallCostYuan(model))
}

/** 折数：平台单价 ÷ 官网参考单价，1 折 = 官网价的 10%。 */
function discountTenths(model: TextModel): number {
  return (
    (pointsPerCall(model) / POINTS_PER_YUAN / officialCallCostYuan(model)) * 10
  )
}

/** 例如 "7.5 折"、"<0.1 折"。 */
export function discountLabel(model: TextModel): string {
  const tenths = discountTenths(model)
  if (tenths < 0.1) return '<0.1 折'
  return `${tenths.toFixed(1).replace(/\.0$/, '')} 折`
}

/** 比官网省多少（整数百分比）。 */
export function savingPercent(model: TextModel): number {
  return Math.round((1 - discountTenths(model) / 10) * 100)
}

/** 文本模型里的最低折数，用于顶部优惠条。 */
export function bestTextDiscount(models: TextModel[]): number | null {
  const ratios = models
    .map((model) => discountTenths(model) / 10)
    .filter((ratio) => Number.isFinite(ratio) && ratio > 0 && ratio < 1)
  return ratios.length ? Math.min(...ratios) : null
}

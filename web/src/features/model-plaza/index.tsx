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
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { PublicLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { SubscriptionsCustomFooter } from '@/features/subscriptions-custom/footer'
import { SupportDialog } from '@/features/subscriptions-custom/support-dialog'
import { useAuthStore } from '@/stores/auth-store'
import { useLoginModalStore } from '@/stores/login-modal-store'

import {
  bestTextDiscount,
  callsPerYuan,
  discountLabel,
  isOverseas,
  officialCallsPerYuan,
  savingPercent,
  TEXT_MODELS,
  VIDEO_MODELS,
  type TextModel,
  type VideoModel,
} from './catalog'

import '@/styles/model-plaza.css'

type Filter = { kind: 'all' | 'vendor'; value: string }

const ALL = 'all'

function matches(model: TextModel | VideoModel, keyword: string): boolean {
  if (!keyword) return true
  const haystack = [
    model.id,
    model.vendor,
    'name' in model ? model.name : '',
    'useText' in model ? model.useText : model.spec,
  ]
  return haystack.some((field) => field.toLowerCase().includes(keyword))
}

/** 顶部优惠条：按文本模型里最低折数计算。 */
function DealBanner() {
  const best = bestTextDiscount(TEXT_MODELS)
  if (best === null) {
    return (
      <div className='mp-deal' aria-live='polite'>
        官网参考价与平台价，直接对比
      </div>
    )
  }
  const tenths = best * 10
  const label = tenths < 0.1 ? '<0.1' : tenths.toFixed(1).replace(/\.0$/, '')
  return (
    <div className='mp-deal' aria-live='polite'>
      <span>文本模型低至</span>
      <strong>{label} 折</strong>
      <span>相比官网参考价</span>
      <b>最高省 {Math.round((1 - best) * 100)}%</b>
    </div>
  )
}

function VideoPrices({ videos }: { videos: VideoModel[] }) {
  if (!videos.length) return null
  return (
    <section className='mp-video'>
      <div className='mp-video-head'>
        <h3>视频生成价格</h3>
        <span>按视频时长计价，不采用文本调用次数</span>
      </div>
      <table className='mp-video-table'>
        <thead>
          <tr>
            <th scope='col'>视频模型</th>
            <th scope='col'>生成规格</th>
            <th scope='col'>
              官网参考价<small>元 / 30s 视频</small>
            </th>
            <th scope='col'>平台折扣</th>
            <th scope='col'>
              平台价<small>元 / 30s 视频</small>
            </th>
          </tr>
        </thead>
        <tbody>
          {videos.map((video) => {
            const priced = !!video.pricePer30s && video.pricePer30s > 0
            const official =
              !!video.officialPricePer30s && video.officialPricePer30s > 0
            const discounted =
              priced &&
              official &&
              (video.pricePer30s as number) <
                (video.officialPricePer30s as number)
            const tenths = discounted
              ? ((video.pricePer30s as number) /
                  (video.officialPricePer30s as number)) *
                10
              : null
            return (
              <tr key={video.id}>
                <td data-label='视频模型'>
                  <div className='mp-video-name'>{video.name}</div>
                  <span className='mp-video-status'>{video.status}</span>
                </td>
                <td data-label='生成规格'>{video.spec}</td>
                <td data-label='官网参考价 · 元 / 30s 视频'>
                  <span className='mp-video-official'>
                    {official ? `${video.officialPricePer30s} 元` : '待确认'}
                  </span>
                </td>
                <td data-label='平台折扣'>
                  {tenths === null ? (
                    <span className='mp-video-pending'>待确认</span>
                  ) : (
                    <>
                      <span className='mp-video-discount'>
                        {tenths.toFixed(1).replace(/\.0$/, '')} 折
                      </span>
                      <span className='mp-saving'>
                        比官网省 {Math.round((1 - tenths / 10) * 100)}%
                      </span>
                    </>
                  )}
                </td>
                <td data-label='平台价 · 元 / 30s 视频'>
                  <strong className='mp-video-platform'>
                    {priced ? `${video.pricePer30s} 元` : '价格待定'}
                  </strong>
                  <small className='mp-video-unit'>/ 30s 视频</small>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className='mp-note'>
        30
        秒为统一价格展示口径，不代表单次生成时长。规格与报价确认后开放，未确认前不承诺可用性。
      </p>
    </section>
  )
}

export function ModelPlaza() {
  const isAuthenticated = useAuthStore((state) => !!state.auth.user)
  const [keyword, setKeyword] = useState('')
  const [filter, setFilter] = useState<Filter>({ kind: 'all', value: ALL })
  const [supportOpen, setSupportOpen] = useState(false)

  const domesticVendors = useMemo(() => {
    const vendors = new Map<string, number>()
    for (const model of TEXT_MODELS) {
      if (isOverseas(model)) continue
      vendors.set(model.vendor, (vendors.get(model.vendor) ?? 0) + 1)
    }
    return [...vendors.entries()]
  }, [])

  const overseasVendors = useMemo(() => {
    const vendors = new Map<string, number>()
    for (const model of TEXT_MODELS) {
      if (!isOverseas(model)) continue
      vendors.set(model.vendor, (vendors.get(model.vendor) ?? 0) + 1)
    }
    return [...vendors.entries()]
  }, [])

  const normalized = keyword.trim().toLowerCase()
  const inScope = <T extends TextModel | VideoModel>(model: T) =>
    filter.kind === 'all' || model.vendor === filter.value

  const models = TEXT_MODELS.filter(
    (model) => inScope(model) && matches(model, normalized)
  )
  const videos = VIDEO_MODELS.filter(
    (model) => inScope(model) && matches(model, normalized)
  )

  const heading = filter.kind === 'all' ? '全部模型' : filter.value
  const rowAction = (model: TextModel) =>
    isOverseas(model) ? (
      <span className='mp-unavailable'>暂不开放</span>
    ) : (
      <Button
        size='sm'
        variant='outline'
        render={isAuthenticated ? <Link to='/keys' /> : undefined}
        onClick={() => {
          if (!isAuthenticated) {
            useLoginModalStore.getState().open({ redirectTo: '/keys' })
          }
        }}
      >
        使用此模型
      </Button>
    )

  const filterButton = (value: string, label: string, count: number) => {
    const active =
      (value === ALL && filter.kind === 'all') ||
      (filter.kind === 'vendor' && filter.value === value)
    return (
      <button
        key={value}
        type='button'
        className={`mp-item${active ? ' is-active' : ''}`}
        aria-pressed={active}
        onClick={() =>
          setFilter(
            value === ALL
              ? { kind: 'all', value: ALL }
              : { kind: 'vendor', value }
          )
        }
      >
        <span className='mp-dot' aria-hidden='true' />
        <span className='mp-item-name'>{label}</span>
        <span className='mp-item-count'>{count}</span>
      </button>
    )
  }

  return (
    <PublicLayout showMainContainer={false}>
      <main className='pt-16'>
        <div className='model-plaza'>
          <header className='mp-head'>
            <h1>模型</h1>
            <p>国内外主流模型，一站接入 · 文本对话与视频生成，按需选择</p>
          </header>

          <DealBanner />
          <p className='mp-note'>
            按固定 token 用量比较不同模型配置，平台次数与扣积分规则一致。
          </p>

          <div className='mp-searchbox'>
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              aria-hidden='true'
            >
              <circle cx='11' cy='11' r='8' />
              <path d='m21 21-4.3-4.3' />
            </svg>
            <input
              type='search'
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder='搜模型名或厂商'
              aria-label='搜模型名或厂商'
            />
          </div>

          <div className='mp-plaza'>
            <aside className='mp-side' aria-label='模型筛选'>
              <div className='mp-group'>
                <div className='mp-group-head'>所有模型</div>
                <div className='mp-items'>
                  {filterButton(
                    ALL,
                    '所有模型',
                    TEXT_MODELS.length + VIDEO_MODELS.length
                  )}
                </div>
              </div>
              <div className='mp-group'>
                <div className='mp-group-head'>国内模型</div>
                <div className='mp-items'>
                  {domesticVendors.map(([vendor, count]) =>
                    filterButton(vendor, vendor, count)
                  )}
                </div>
              </div>
              <div className='mp-group'>
                <div className='mp-group-head'>海外模型</div>
                <div className='mp-items'>
                  {overseasVendors.map(([vendor, count]) =>
                    filterButton(vendor, vendor, count)
                  )}
                </div>
              </div>
            </aside>

            <section className='mp-main' aria-labelledby='mp-scope'>
              <div className='mp-main-head'>
                <h2 id='mp-scope'>{heading}</h2>
                <span className='mp-count'>
                  共 {models.length + videos.length} 项
                </span>
              </div>

              {models.length > 0 && (
                <table className='mp-table'>
                  <thead>
                    <tr>
                      <th scope='col'>模型名称</th>
                      <th scope='col'>适合做什么</th>
                      <th scope='col' className='is-right'>
                        官网 ￥1 能发约
                      </th>
                      <th scope='col' className='is-right'>
                        折扣比例
                      </th>
                      <th scope='col' className='is-right'>
                        我们 ￥1 能发约
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((model) => (
                      <tr key={model.id}>
                        <td data-label='模型名称'>
                          <div className='mp-name'>{model.id}</div>
                          {rowAction(model)}
                        </td>
                        <td data-label='适合做什么' className='mp-use'>
                          {model.useText}
                        </td>
                        <td data-label='官网 ￥1 能发约' className='is-right'>
                          <span className='mp-official'>
                            {officialCallsPerYuan(model)} 次
                          </span>
                        </td>
                        <td data-label='折扣比例' className='is-right'>
                          <span className='mp-discount'>
                            {discountLabel(model)}
                          </span>
                          <span className='mp-saving'>
                            比官网省 {savingPercent(model)}%
                          </span>
                        </td>
                        <td data-label='我们 ￥1 能发约' className='is-right'>
                          <span className='mp-calls'>
                            {callsPerYuan(model)} 次
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {models.length > 0 && (
                <p className='mp-note'>
                  文本次数按每次输入 2,000 / 输出 500 token
                  估算，不等同于中文字数。平台次数按 1 元购买 1,000
                  积分及实际扣减规则计算，每次最低 1
                  积分、四舍五入到整数；实际用量变化会影响次数。官网参考价为对比基准，不随第三方报价实时变动。
                </p>
              )}

              {models.length === 0 && videos.length === 0 && (
                <p className='mp-empty'>没找到匹配的模型，换个关键词试试</p>
              )}

              <VideoPrices videos={videos} />
            </section>
          </div>
        </div>
      </main>
      <SupportDialog open={supportOpen} onOpenChange={setSupportOpen} />
      <SubscriptionsCustomFooter onContact={() => setSupportOpen(true)} />
    </PublicLayout>
  )
}

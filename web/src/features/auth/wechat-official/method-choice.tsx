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
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import type { OfficialRequest } from './api'
import { OfficialWeChatAuthorization } from './authorization'

export function WeChatMethodChoice(props: {
  methods: ('code' | 'official')[]
  request: OfficialRequest
  enabled?: boolean
  afterQr?: ReactNode
  onResult: (result: unknown, request: OfficialRequest) => void | Promise<void>
  onMethodChange?: (method: 'code' | 'official') => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [chosen, setChosen] = useState<'code' | 'official'>('official')
  const method = props.methods.includes(chosen) ? chosen : props.methods[0]
  return (
    <div className='space-y-3'>
      {props.methods.length > 1 && (
        <Tabs
          value={method}
          onValueChange={(value) => {
            setChosen(value as 'code' | 'official')
            props.onMethodChange?.(value as 'code' | 'official')
          }}
        >
          <TabsList
            aria-label={t('WeChat')}
            className='grid w-full grid-cols-1 group-data-horizontal/tabs:h-auto sm:grid-cols-2'
          >
            <TabsTrigger
              value='official'
              className='h-auto min-h-8 whitespace-normal'
            >
              {t('WeChat Official Account authorization')}
            </TabsTrigger>
            <TabsTrigger
              value='code'
              className='h-auto min-h-8 whitespace-normal'
            >
              {t('WeChat verification code')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {method === 'official' && (
        <OfficialWeChatAuthorization
          request={props.request}
          enabled={props.enabled}
          afterQr={props.afterQr}
          onResult={props.onResult}
        />
      )}
      {method === 'code' && props.children}
      {!method && <p>{t('WeChat sign in is not enabled')}</p>}
    </div>
  )
}

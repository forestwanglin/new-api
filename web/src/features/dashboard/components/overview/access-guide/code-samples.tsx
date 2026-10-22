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
import { Copy, Loader2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { CodeBlock } from '@/components/ai-elements/code-block'
import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  buildCurlCommand,
  buildPythonSample,
  type CodeSampleArgs,
} from '@/features/dashboard/lib/access-guide'

export type AccessCodeSampleTab = 'curl' | 'python' | 'client'

type AccessCodeSamplesProps = {
  args: CodeSampleArgs
  hasKey: boolean
  copying: boolean
  onCopyCommand: (tab: Exclude<AccessCodeSampleTab, 'client'>) => void
  onCopyFullKey: () => void
}

/**
 * Fixed copy shown in place of the generated samples while the user owns no
 * API key. It points at the empty-key card above instead of rendering a
 * command that could never run (`sk-...` + a model they have not unlocked).
 */
function EmptyCodeSamples() {
  const { t } = useTranslation()
  const steps = [
    t('1. Click the “Create now” button above.'),
    t('2. Pick a group (for example the DeepSeek or GPT series).'),
    t('3. Copy base_url / api_key / model here into your client.'),
  ]

  return (
    <div className='bg-muted/20 rounded-lg border p-4 font-mono text-[13px] leading-6'>
      <p className='text-muted-foreground'>{`# ${t(
        'Create and select an API key to generate runnable code samples here.'
      )}`}</p>
      <div className='mt-3 flex flex-col gap-1'>
        {steps.map((step) => (
          <span key={step}>{step}</span>
        ))}
      </div>
    </div>
  )
}

export function AccessCodeSamples(props: AccessCodeSamplesProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<AccessCodeSampleTab>('curl')

  const code = useMemo(
    () =>
      tab === 'python'
        ? buildPythonSample(props.args)
        : buildCurlCommand(props.args),
    [props.args, tab]
  )

  const clientRows = [
    { key: 'Endpoint' as const, value: props.args.baseUrl },
    { key: 'API Key' as const, value: props.args.apiKey },
    { key: 'Model' as const, value: props.args.model },
  ]

  let sampleContent: ReactNode
  if (!props.hasKey) {
    sampleContent = <EmptyCodeSamples />
  } else if (tab === 'client') {
    sampleContent = (
      <div className='bg-muted/20 flex flex-col gap-2 rounded-lg border p-3'>
        {clientRows.map((row) => (
          <div
            key={row.key}
            className='flex items-center justify-between gap-3'
          >
            <span className='text-muted-foreground shrink-0 text-xs'>
              {t(row.key)}
            </span>
            <span className='flex min-w-0 items-center gap-1'>
              <code className='truncate font-mono text-xs'>{row.value}</code>
              {row.key === 'API Key' ? (
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='size-7 shrink-0'
                  aria-label={t('Copy to clipboard')}
                  disabled={props.copying}
                  onClick={props.onCopyFullKey}
                >
                  {props.copying ? (
                    <Loader2 className='size-3.5 animate-spin' />
                  ) : (
                    <Copy className='size-3.5' />
                  )}
                </Button>
              ) : (
                <CopyButton
                  value={row.value}
                  aria-label={t('Copy to clipboard')}
                  iconClassName='size-3.5'
                  className='size-7'
                />
              )}
            </span>
          </div>
        ))}
        <p className='text-muted-foreground text-xs'>
          {t('Select OpenAI Compatible as the protocol.')}
        </p>
      </div>
    )
  } else {
    sampleContent = (
      <CodeBlock
        code={code}
        language={tab === 'python' ? 'python' : 'bash'}
        showToolbar
        title={tab === 'python' ? 'Python (OpenAI SDK)' : 'curl'}
      >
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='h-7 gap-1.5 px-2 text-xs'
          disabled={props.copying}
          onClick={() => props.onCopyCommand(tab)}
        >
          {props.copying ? (
            <Loader2 className='size-3.5 animate-spin' />
          ) : (
            <Copy className='size-3.5' />
          )}
          {t('Copy')}
        </Button>
      </CodeBlock>
    )
  }

  return (
    <div className='flex flex-col gap-2'>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as AccessCodeSampleTab)}
      >
        <TabsList className='bg-muted/40 h-8 p-0.5'>
          <TabsTrigger value='curl' className='h-7 px-2.5 text-xs'>
            curl
          </TabsTrigger>
          <TabsTrigger value='python' className='h-7 px-2.5 text-xs'>
            Python (OpenAI SDK)
          </TabsTrigger>
          <TabsTrigger value='client' className='h-7 px-2.5 text-xs'>
            {t('Client configuration')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {sampleContent}
    </div>
  )
}

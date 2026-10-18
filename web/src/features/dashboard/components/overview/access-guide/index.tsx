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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronUp, Rocket } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { CardStaggerItem } from '@/components/page-transition'
import { Button } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { createApiKey, fetchTokenKey, getApiKeys } from '@/features/keys/api'
import type { ApiKeyGroupOption } from '@/features/keys/components/api-key-group-combobox'
import {
  getApiKeyFormDefaultValues,
  transformFormDataToPayload,
} from '@/features/keys/lib'
import { usePricingData } from '@/features/pricing/hooks'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { getUserGroups, getUserModels } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { useApiInfo } from '../../../hooks/use-status-data'
import {
  buildCurlCommand,
  buildPythonSample,
  formatDisplayKey,
  normalizeEndpoint,
  pickFirstKey,
  selectModelsForGroup,
  toBaseUrl,
  type CodeSampleArgs,
} from '../../../lib/access-guide'
import { AccessCodeSamples, type AccessCodeSampleTab } from './code-samples'
import { CreateKeyForm, type CreateKeyInput } from './create-key-form'
import { KeySelector } from './key-selector'
import { ModelChips } from './model-chips'

const API_KEYS_QUERY_KEY = ['dashboard', 'overview', 'api-keys'] as const
const USER_MODELS_QUERY_KEY = ['dashboard', 'overview', 'user-models'] as const
const GROUPS_QUERY_KEY = ['dashboard', 'overview', 'groups'] as const

function EmptyKeyState(props: { onCreate: () => void }) {
  const { t } = useTranslation()

  return (
    <div className='border-primary/40 bg-primary/5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-3'>
      <div className='min-w-0'>
        <div className='text-sm font-medium'>{t('No API key yet')}</div>
        <div className='text-muted-foreground text-xs'>
          {t('Create a key to unlock models and ready-to-run code samples.')}
        </div>
      </div>
      <Button type='button' size='sm' onClick={props.onCreate}>
        {t('Create now')}
      </Button>
    </div>
  )
}

/**
 * Overview onboarding card: endpoint, API key, group models and copyable code
 * samples in one place. Replaces the previous setup guide.
 */
export function AccessGuideCard(props: { onHide: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { items: apiInfoItems } = useApiInfo()
  const pricing = usePricingData()
  const { copyToClipboard } = useCopyToClipboard({ notify: false })
  const [creating, setCreating] = useState(false)
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null)
  const [selectedModel, setSelectedModel] = useState('')
  const [copying, setCopying] = useState(false)

  const apiKeysQuery = useQuery({
    queryKey: API_KEYS_QUERY_KEY,
    queryFn: async () => {
      const result = requireServerSuccess(await getApiKeys({ p: 1, size: 10 }))
      return result.success ? (result.data?.items ?? []) : []
    },
    staleTime: 60 * 1000,
  })

  const userModelsQuery = useQuery({
    queryKey: USER_MODELS_QUERY_KEY,
    queryFn: async () => {
      const result = requireServerSuccess(await getUserModels())
      return result.success ? (result.data ?? []) : []
    },
    staleTime: 5 * 60 * 1000,
  })

  const groupsQuery = useQuery({
    queryKey: GROUPS_QUERY_KEY,
    queryFn: async () => {
      const result = requireServerSuccess(await getUserGroups())
      return result.success ? (result.data ?? {}) : {}
    },
    staleTime: 5 * 60 * 1000,
  })

  const keys = useMemo(() => apiKeysQuery.data ?? [], [apiKeysQuery.data])
  // Default to the newest key (backend orders tokens by `id desc`), but let the
  // user switch to any other key they already own.
  const currentKey = useMemo(
    () => keys.find((key) => key.id === selectedKeyId) ?? pickFirstKey(keys),
    [keys, selectedKeyId]
  )
  const group = currentKey?.group?.trim() ?? ''

  const models = useMemo(
    () =>
      selectModelsForGroup(userModelsQuery.data ?? [], pricing.models, group),
    [group, pricing.models, userModelsQuery.data]
  )
  const activeModel = useMemo(() => {
    if (models.some((model) => model.model_name === selectedModel)) {
      return selectedModel
    }
    return models[0]?.model_name ?? ''
  }, [models, selectedModel])

  const groupOptions = useMemo<ApiKeyGroupOption[]>(
    () =>
      Object.entries(groupsQuery.data ?? {}).map(([name, info]) => ({
        value: name,
        label: name,
        desc: info?.desc || undefined,
        ratio: info?.ratio,
      })),
    [groupsQuery.data]
  )

  const chatEndpoint = useMemo(
    () => normalizeEndpoint(apiInfoItems[0]?.url),
    [apiInfoItems]
  )
  const baseUrl = useMemo(() => toBaseUrl(chatEndpoint), [chatEndpoint])
  const displayKey = currentKey ? formatDisplayKey(currentKey.key) : 'sk-...'
  const sampleArgs = useMemo<CodeSampleArgs>(
    () => ({
      baseUrl,
      endpoint: chatEndpoint,
      apiKey: displayKey,
      model: activeModel,
    }),
    [activeModel, baseUrl, chatEndpoint, displayKey]
  )

  const createMutation = useMutation({
    mutationFn: async (input: CreateKeyInput) => {
      const payload = transformFormDataToPayload({
        ...getApiKeyFormDefaultValues(false),
        name: input.name,
        group: input.group,
      })
      return requireServerSuccess(await createApiKey(payload))
    },
    onSuccess: async () => {
      setCreating(false)
      setSelectedKeyId(null)
      setSelectedModel('')
      await queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY })
      toast.success(t('API Key created successfully'))
    },
    onError: (error) => {
      handleServerError(error, t('Failed to create API key'))
    },
  })

  const handleCreate = (input: CreateKeyInput) => {
    if (!input.group) {
      toast.error(t('Pick a group first'))
      return
    }
    createMutation.mutate({
      name: input.name || t('Create API Key'),
      group: input.group,
    })
  }

  const handleSelectKey = (id: number) => {
    setSelectedKeyId(id)
    setSelectedModel('')
  }

  const resolveFullKey = async (): Promise<string | null> => {
    if (!currentKey) return null
    try {
      const result = await fetchTokenKey(currentKey.id)
      const key = result.success && result.data?.key ? result.data.key : ''
      if (!key) {
        handleServerError(result, t('Failed to copy to clipboard'))
        return null
      }
      return `sk-${key}`
    } catch (error) {
      handleServerError(error, t('Failed to copy to clipboard'))
      return null
    }
  }

  const copyWithFullKey = async (build: (fullKey: string) => string) => {
    if (copying) return
    setCopying(true)
    try {
      const fullKey = await resolveFullKey()
      if (!fullKey) return
      const copied = await copyToClipboard(build(fullKey))
      if (copied) {
        toast.success(t('Copied to clipboard'))
      } else {
        toast.error(t('Failed to copy to clipboard'))
      }
    } finally {
      setCopying(false)
    }
  }

  const handleCopyFullKey = () => copyWithFullKey((fullKey) => fullKey)

  const handleCopyCommand = (tab: Exclude<AccessCodeSampleTab, 'client'>) =>
    copyWithFullKey((fullKey) => {
      const args = { ...sampleArgs, apiKey: fullKey }
      return tab === 'python' ? buildPythonSample(args) : buildCurlCommand(args)
    })

  let apiKeyContent: ReactNode
  if (apiKeysQuery.isPending) {
    apiKeyContent = <Skeleton className='h-14 w-full rounded-lg' />
  } else if (currentKey) {
    apiKeyContent = (
      <KeySelector
        keys={keys}
        value={currentKey.id}
        maskedKey={displayKey}
        ratioByGroup={pricing.groupRatio}
        copying={copying}
        onValueChange={handleSelectKey}
        onCopyFullKey={handleCopyFullKey}
      />
    )
  } else if (creating) {
    apiKeyContent = (
      <CreateKeyForm
        defaultName={`my-key-${keys.length + 1}`}
        groupOptions={groupOptions}
        submitting={createMutation.isPending}
        onCancel={() => setCreating(false)}
        onSubmit={handleCreate}
      />
    )
  } else {
    apiKeyContent = <EmptyKeyState onCreate={() => setCreating(true)} />
  }

  return (
    <CardStaggerItem className='bg-card h-full overflow-hidden rounded-2xl border shadow-xs'>
      <div className='flex h-full flex-col gap-5 p-4 sm:p-5'>
        <div className='flex flex-col gap-1'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div className='flex min-w-0 items-center gap-2'>
              <IconBadge tone='primary' size='sm'>
                <Rocket />
              </IconBadge>
              <h3 className='truncate text-sm font-semibold'>
                {t('Build your first app')}
              </h3>
            </div>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-7 shrink-0 gap-1.5 px-2 text-xs'
              onClick={props.onHide}
            >
              <ChevronUp className='size-3.5' aria-hidden='true' />
              {t('Hide setup guide')}
            </Button>
          </div>
          <p className='text-muted-foreground text-xs leading-relaxed'>
            {t(
              'Fill these values into any client that supports the OpenAI protocol.'
            )}
          </p>
        </div>

        <div className='grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center'>
          <span className='text-muted-foreground text-xs font-medium'>
            {t('Endpoint')}
          </span>
          <div className='bg-muted/40 flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2'>
            <code className='min-w-0 flex-1 truncate font-mono text-xs'>
              {baseUrl}
            </code>
            <CopyButton
              value={baseUrl}
              className='size-7'
              iconClassName='size-3.5'
              aria-label={t('Copy to clipboard')}
            />
          </div>
        </div>

        <div className='grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]'>
          <span className='text-muted-foreground text-xs font-medium'>
            {t('API Key')}
          </span>
          <div className='min-w-0'>{apiKeyContent}</div>
        </div>

        <div className='grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]'>
          <span className='text-muted-foreground text-xs font-medium'>
            {t('Select model')}
          </span>
          <div className='min-w-0'>
            <ModelChips
              models={models}
              selected={activeModel}
              group={group}
              groupRatio={pricing.groupRatio}
              priceRate={pricing.priceRate}
              usdExchangeRate={pricing.usdExchangeRate}
              onSelect={setSelectedModel}
            />
          </div>
        </div>

        <AccessCodeSamples
          args={sampleArgs}
          hasKey={Boolean(currentKey)}
          copying={copying}
          onCopyCommand={handleCopyCommand}
        />
      </div>
    </CardStaggerItem>
  )
}

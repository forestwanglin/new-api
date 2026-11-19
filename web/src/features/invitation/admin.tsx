import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import type { StaticDataTableColumn } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { InvitationAdminTable } from './admin-table'
import { getAdminCampaigns, campaignAction, type Campaign } from './api'
import { CampaignEditor } from './campaign-editor'
import { InvitationRefundAdmin } from './refund-admin'
import { InvitationRewardAdmin } from './reward-admin'

export function InvitationCampaignAdmin() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const viewer = useAuthStore((s) => s.auth.user?.id)
  const [tab, setTab] = useState('campaigns')
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [editor, setEditor] = useState<{
    campaign: Campaign | null
    copy: boolean
  } | null>(null)
  const [ending, setEnding] = useState<Campaign | null>(null)
  const q = useQuery({
    queryKey: ['invitation', 'admin', 'campaigns', viewer, pagination],
    queryFn: () =>
      getAdminCampaigns(pagination.pageIndex + 1, pagination.pageSize),
    enabled: tab === 'campaigns',
  })
  const action = useMutation({
    mutationFn: ({ c, a }: { c: Campaign; a: 'publish' | 'end' }) =>
      campaignAction(c, a),
    onSuccess: () => {
      setEnding(null)
      void qc.invalidateQueries({ queryKey: ['invitation', 'admin'] })
    },
  })
  const statuses = {
    draft: t('Draft campaign'),
    upcoming: t('Upcoming campaign'),
    active: t('Active campaign'),
    ended: t('Ended campaign'),
  }
  const columns: StaticDataTableColumn<Campaign>[] = [
    {
      id: 'name',
      header: t('Campaign name'),
      cell: (c) => (
        <div className='max-w-64 font-medium break-words'>
          {c.name}
          <p className='text-muted-foreground text-xs'>
            {c.code} · {t('Campaign period')} {c.period}
          </p>
        </div>
      ),
    },
    {
      id: 'time',
      header: t('Time'),
      cell: (c) => (
        <div>
          {new Date(Number(c.starts_at)).toLocaleString()} –{' '}
          {new Date(Number(c.ends_at)).toLocaleString()}
          {c.status === 'draft' && Number(c.ends_at) <= Date.now() && (
            <p className='text-destructive text-xs'>
              {t('Campaign end time has passed. Set a future end time.')}
            </p>
          )}
        </div>
      ),
    },
    { id: 'status', header: t('Status'), cell: (c) => statuses[c.status] },
    {
      id: 'reward',
      header: t('Reward point type'),
      cell: (c) => c.reward_point_type.name,
    },
    { id: 'freeze', header: t('Freeze days'), cell: (c) => c.freeze_days },
    {
      id: 'visible',
      header: t('Visible'),
      cell: (c) => (c.visible ? t('Yes') : t('No')),
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: (c) => (
        <div className='flex flex-wrap gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={c.status !== 'draft' || action.isPending}
            onClick={() => setEditor({ campaign: c, copy: false })}
          >
            {t('Edit')}
          </Button>
          <Button
            size='sm'
            variant='outline'
            onClick={() => setEditor({ campaign: c, copy: true })}
          >
            {t('Copy to next campaign')}
          </Button>
          {c.status === 'draft' && (
            <Button
              size='sm'
              disabled={action.isPending}
              onClick={() => action.mutate({ c, a: 'publish' })}
            >
              {t('Publish')}
            </Button>
          )}
          {c.published_version !== null && c.status !== 'ended' && (
            <Button
              size='sm'
              variant='destructive'
              disabled={action.isPending}
              onClick={() => setEnding(c)}
            >
              {t('End')}
            </Button>
          )}
        </div>
      ),
    },
  ]
  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        {t('Invitation campaigns')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 min-w-0 flex-col gap-4'>
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(String(value))}
            className='flex h-full min-h-0 flex-col gap-4'
          >
            <div className='shrink-0 overflow-x-auto'>
              <TabsList variant='line' aria-label={t('Invitation campaigns')}>
                <TabsTrigger value='campaigns'>
                  {t('Campaign list')}
                </TabsTrigger>
                <TabsTrigger value='rewards'>
                  {t('Invitation reward orders')}
                </TabsTrigger>
                <TabsTrigger value='refunds'>
                  {t('Invitation reward refund registrations')}
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent
              value='campaigns'
              keepMounted
              className='flex min-h-0 flex-col gap-4 data-[hidden]:hidden'
            >
              {tab === 'campaigns' && (
                <>
                  <div className='flex shrink-0 flex-wrap items-center justify-between gap-3'>
                    <p className='text-muted-foreground text-sm'>
                      {t('Only one campaign can be active at a time')}
                    </p>
                    <Button
                      onClick={() => setEditor({ campaign: null, copy: false })}
                    >
                      {t('New campaign')}
                    </Button>
                  </div>
                  {action.isError && (
                    <ErrorState
                      description={getServerErrorMessage(action.error)}
                    />
                  )}
                  <InvitationAdminTable
                    rows={q.data?.items ?? []}
                    columns={columns}
                    total={q.data?.total ?? '0'}
                    pagination={pagination}
                    onPaginationChange={setPagination}
                    pending={q.isPending}
                    error={q.error}
                    onRetry={() => void q.refetch()}
                  />
                </>
              )}
            </TabsContent>
            <TabsContent
              value='rewards'
              keepMounted
              className='flex min-h-0 flex-col gap-4 data-[hidden]:hidden'
            >
              <InvitationRewardAdmin active={tab === 'rewards'} />
            </TabsContent>
            <TabsContent
              value='refunds'
              keepMounted
              className='flex min-h-0 flex-col gap-4 data-[hidden]:hidden'
            >
              <InvitationRefundAdmin active={tab === 'refunds'} />
            </TabsContent>
          </Tabs>
        </div>
        {editor && (
          <CampaignEditor
            campaign={editor.campaign}
            copy={editor.copy}
            onClose={() => setEditor(null)}
          />
        )}
        <ConfirmDialog
          open={ending !== null}
          onOpenChange={(open) => {
            if (!open && !action.isPending) setEnding(null)
          }}
          title={t('End campaign')}
          desc={ending?.name ?? ''}
          confirmText={t('End')}
          destructive
          isLoading={action.isPending}
          handleConfirm={() => {
            if (ending) action.mutate({ c: ending, a: 'end' })
          }}
        />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

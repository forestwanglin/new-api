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
import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { isHttpUrl, isLikelyHtml } from '@/lib/content-format'
import {
  requireServerSuccess,
  getServerErrorMessage,
} from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import {
  getPrivacyPolicy,
  getSubscriptionAgreement,
  getUserAgreement,
} from './api'

export type AgreementKind = 'user' | 'privacy' | 'subscription'
const documentFetchers = {
  user: getUserAgreement,
  privacy: getPrivacyPolicy,
  subscription: getSubscriptionAgreement,
}

interface AgreementConsentProps {
  documents: AgreementKind[]
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  className?: string
}

export function AgreementConsent(props: AgreementConsentProps) {
  const { t } = useTranslation()
  const id = useId()
  const [document, setDocument] = useState<AgreementKind | null>(null)
  const titles = {
    user: t('User Agreement'),
    privacy: t('Privacy Policy'),
    subscription: t('Personal Subscription Service Agreement'),
  }
  if (!props.documents.length) return null
  return (
    <>
      <div
        className={cn(
          'agreement-consent flex items-start gap-2 text-left text-xs leading-5',
          props.className
        )}
      >
        <Checkbox
          id={id}
          checked={props.checked}
          onCheckedChange={(value) => props.onCheckedChange(value === true)}
          className='mt-0.5 shrink-0'
          aria-label={`${t('I have read and agree to the')} ${props.documents
            .map((kind) => titles[kind])
            .join(' ')}`}
        />
        <div className='text-muted-foreground min-w-0'>
          <Label
            htmlFor={id}
            className='agreement-consent-label inline text-xs font-normal'
          >
            {t('I have read and agree to the')}
          </Label>{' '}
          {props.documents.map((kind, index) => (
            <span key={kind}>
              {index > 0 && ` ${t('and')} `}
              <Button
                type='button'
                variant='link'
                className='agreement-document-link inline h-auto p-0 text-xs whitespace-normal'
                onClick={() => setDocument(kind)}
              >
                {titles[kind]}
              </Button>
            </span>
          ))}
        </div>
      </div>
      {document && (
        <AgreementDetail
          kind={document}
          title={titles[document]}
          onClose={() => setDocument(null)}
        />
      )}
    </>
  )
}

function AgreementDetail(props: {
  kind: AgreementKind
  title: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['legal-document', props.kind],
    queryFn: async () =>
      requireServerSuccess(await documentFetchers[props.kind]()),
    staleTime: 0,
    retry: false,
    meta: { errorToast: false },
  })
  const content = query.data?.data?.trim() ?? ''
  const legacy = props.kind !== 'subscription'
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={props.title}
      contentHeight='min(60vh, 32rem)'
      footer={
        <Button type='button' onClick={props.onClose}>
          {t('Close')}
        </Button>
      }
    >
      {query.isPending && <LoadingState />}
      {query.isError && (
        <ErrorState
          description={getServerErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.isSuccess && !content && (
        <p>{t('The administrator has not configured this agreement yet.')}</p>
      )}
      {query.isSuccess &&
        content &&
        (legacy && isHttpUrl(content) ? (
          <a
            href={content}
            target='_blank'
            rel='noopener noreferrer'
            className='text-primary underline underline-offset-4'
          >
            {t('View document')}
          </a>
        ) : (
          <RichContent
            content={content}
            mode={legacy && isLikelyHtml(content) ? 'html' : 'markdown'}
            htmlVariant='isolated'
            className='max-w-none'
          />
        ))}
    </Dialog>
  )
}

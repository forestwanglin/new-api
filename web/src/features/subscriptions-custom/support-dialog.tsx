import { Mail, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { useStatus } from '@/hooks/use-status'

type Props = { open: boolean; onOpenChange: (open: boolean) => void }
export function SupportDialog(props: Props) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const wecom = status?.support_wecom?.trim() ?? ''
  const email = status?.operations_email?.trim() ?? ''
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Contact support')}
      description={t(
        'Contact us for integration errors, billing questions, invoices, and bulk purchases. Available weekdays, 9:00–21:00.'
      )}
      contentClassName='sm:max-w-lg'
      footer={
        <Button onClick={() => props.onOpenChange(false)}>{t('Got it')}</Button>
      }
    >
      <div className='divide-border divide-y'>
        <div className='flex flex-wrap items-center gap-3 py-4'>
          <MessageSquare
            aria-hidden
            className='bg-muted size-9 rounded-lg p-2'
          />
          <div className='min-w-0 flex-1'>
            <h3 className='text-sm font-semibold'>
              {t('WeCom (fastest response)')}
            </h3>
            <p className='text-muted-foreground text-xs break-all'>
              {wecom || t('Not configured yet')}
            </p>
          </div>
          <CopyButton
            value={wecom}
            disabled={!wecom}
            variant='outline'
            size='sm'
            aria-label={t('Copy WeCom ID')}
          >
            {t('Copy WeCom ID')}
          </CopyButton>
        </div>
        <div className='flex flex-wrap items-center gap-3 py-4'>
          <Mail aria-hidden className='bg-muted size-9 rounded-lg p-2' />
          <div className='min-w-0 flex-1'>
            <h3 className='text-sm font-semibold'>{t('Operations Email')}</h3>
            <p className='text-muted-foreground text-xs break-all'>
              {email || t('Not configured yet')}
            </p>
          </div>
          <CopyButton
            value={email}
            disabled={!email}
            variant='outline'
            size='sm'
            aria-label={t('Copy email')}
          >
            {t('Copy email')}
          </CopyButton>
        </div>
      </div>
    </Dialog>
  )
}

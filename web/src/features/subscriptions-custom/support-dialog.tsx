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
      title='联系客服'
      description='接入报错、扣费疑问、开票与批量采购都可以找我们。工作日 9:00–21:00 在线。'
      contentClassName='sm:max-w-lg'
      footer={<Button onClick={() => props.onOpenChange(false)}>知道了</Button>}
    >
      <div className='divide-border divide-y'>
        <div className='flex flex-wrap items-center gap-3 py-4'>
          <MessageSquare
            aria-hidden
            className='bg-muted size-9 rounded-lg p-2'
          />
          <div className='min-w-0 flex-1'>
            <h3 className='text-sm font-semibold'>企业微信（响应最快）</h3>
            <p className='text-muted-foreground text-xs break-all'>
              {wecom || t('Not configured yet')}
            </p>
          </div>
          <CopyButton
            value={wecom}
            disabled={!wecom}
            variant='outline'
            size='sm'
            aria-label='复制微信号'
          >
            复制微信号
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
            aria-label='复制邮箱'
          >
            复制邮箱
          </CopyButton>
        </div>
      </div>
    </Dialog>
  )
}

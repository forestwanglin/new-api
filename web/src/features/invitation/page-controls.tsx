import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

export function PageControls({
  page,
  total,
  onChange,
}: {
  page: number
  total: string
  onChange: (n: number) => void
}) {
  const { t } = useTranslation()
  return (
    <div className='mt-4 flex items-center gap-3'>
      <Button
        variant='outline'
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
      >
        {t('Previous')}
      </Button>
      <span>{page}</span>
      <Button
        variant='outline'
        disabled={BigInt(page) * 20n >= BigInt(total)}
        onClick={() => onChange(page + 1)}
      >
        {t('Next')}
      </Button>
    </div>
  )
}

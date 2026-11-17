import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { HeaderLogo } from '@/components/layout/components/header-logo'
import { Button, buttonVariants } from '@/components/ui/button'
import { useSystemConfig } from '@/hooks/use-system-config'

import '@/styles/subscriptions-custom-footer.css'

type Props = { onContact: () => void }

/** Shared footer for custom public pages. */
export function SubscriptionsCustomFooter(props: Props) {
  const { t } = useTranslation()
  const { systemName, logo, loading, logoLoaded } = useSystemConfig()
  const year = new Date().getFullYear()
  return (
    <footer className='subscriptions-custom-footer'>
      <div className='sub-footer-wrap'>
        <div className='sub-footer-main'>
          <div>
            <Link className='sub-footer-brand' to='/'>
              <HeaderLogo
                src={logo}
                alt={t('Logo')}
                loading={loading}
                logoLoaded={logoLoaded}
                className='size-[30px] shrink-0 rounded-lg object-contain'
              />
              <span>{systemName}</span>
            </Link>
            <p className='sub-footer-desc'>
              {t(
                'Connect leading AI models to the tools you already use. Subscribe to earn points, pay per call, and keep your points forever.'
              )}
            </p>
          </div>
          <div className='sub-footer-columns'>
            <div>
              <h2>{t('Help')}</h2>
              <Link
                to='/tutorial'
                className={buttonVariants({ variant: 'link' })}
              >
                {t('Common errors')}
              </Link>
              <Button variant='link' onClick={props.onContact}>
                {t('Contact support')}
              </Button>
            </div>
            <div>
              <h2>{t('Partnerships')}</h2>
              <Button variant='link' onClick={props.onContact}>
                {t('Partnership inquiries')}
              </Button>
              <Button variant='link' onClick={props.onContact}>
                {t('Contact our partnership team')}
              </Button>
            </div>
          </div>
        </div>
        <div className='sub-footer-copy'>
          <span>
            © {year} {systemName}
          </span>
          <span className='sub-footer-attribution'>
            © {year}{' '}
            <a
              href='https://github.com/QuantumNous/new-api'
              target='_blank'
              rel='noopener noreferrer'
            >
              New API
            </a>
            . {t('footer.newapi.projectAttributionSuffix')}
          </span>
        </div>
      </div>
    </footer>
  )
}

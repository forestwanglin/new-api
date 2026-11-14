import { Link } from '@tanstack/react-router'

import '@/styles/subscriptions-custom-footer.css'
import { Button, buttonVariants } from '@/components/ui/button'

type Props = { onContact: () => void }

/** Demo footer, scoped to the custom subscription page only. */
export function SubscriptionsCustomFooter(props: Props) {
  return (
    <footer className='subscriptions-custom-footer'>
      <div className='sub-footer-wrap'>
        <div className='sub-footer-main'>
          <div>
            <a className='sub-footer-brand' href='/'>
              <span className='sub-footer-logo' aria-hidden='true'>
                Z
              </span>
              <span>ZYY AI</span>
            </a>
            <p className='sub-footer-desc'>
              把主流大模型接进你正在用的工具。订阅获得积分，按调用扣积分，积分永久有效。
            </p>
          </div>
          <div className='sub-footer-columns'>
            <div>
              <h2>帮助</h2>
              <Link
                to='/tutorial'
                className={buttonVariants({ variant: 'link' })}
              >
                常见报错
              </Link>
              <Button variant='link' onClick={props.onContact}>
                联系客服
              </Button>
            </div>
            <div>
              <h2>合作</h2>
              <Button variant='link' onClick={props.onContact}>
                合作咨询
              </Button>
              <Button variant='link' onClick={props.onContact}>
                联系合作
              </Button>
            </div>
          </div>
        </div>
        <div className='sub-footer-copy'>
          <span>© 2026 ZYY AI</span>
          <span className='sub-footer-attribution'>
            © 2026{' '}
            <a
              href='https://github.com/QuantumNous/new-api'
              target='_blank'
              rel='noopener noreferrer'
            >
              New API
            </a>
            . 版权所有，由项目贡献者设计与开发。
          </span>
        </div>
      </div>
    </footer>
  )
}

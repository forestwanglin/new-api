import { useEffect, useState } from 'react'

import { useAccountSecurity } from '@/features/security/hooks/use-account-security'

import {
  startPhoneBinding,
  type PhoneBindingAuthorization,
  type PhoneChangeStatus,
} from './api'

/** Both account pages use the same server-selected first-binding ceremony. */
export function usePhoneChange(status: PhoneChangeStatus | undefined) {
  const [open, setOpen] = useState(false)
  const [bindingAuthorization, setBindingAuthorization] =
    useState<PhoneBindingAuthorization>()
  const security = useAccountSecurity()
  useEffect(() => {
    setOpen(false)
    setBindingAuthorization(undefined)
  }, [security.sessionKey])
  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) setBindingAuthorization(undefined)
  }
  const start = async () => {
    if (!status || security.pending) return
    if (status.bound) {
      setOpen(true)
      return
    }
    const authorization = await security.run(async (signal) => {
      const proof = await security.verify({ scope: 'phone.binding' }, signal)
      return {
        ...(await startPhoneBinding(proof, signal)),
        notification_warning: false,
      }
    })
    if (!authorization) return
    setBindingAuthorization(authorization)
    setOpen(true)
  }
  return {
    open,
    onOpenChange,
    start,
    bindingAuthorization,
    pending: security.pending,
    verificationDialogProps: security.verificationDialogProps,
  }
}

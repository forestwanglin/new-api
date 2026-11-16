const KEY = 'invitation.binding.intent'
export function saveBindingIntent(invitation: string, now = Date.now()) {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({ invitation, expiresAt: now + 15 * 60 * 1000 })
  )
}
export function readBindingIntent(now = Date.now()) {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
    if (
      typeof v?.invitation === 'string' &&
      v.invitation.length <= 2048 &&
      Number.isSafeInteger(v.expiresAt) &&
      v.expiresAt > now
    ) {
      return v.invitation
    }
    clearBindingIntent()
    return ''
  } catch {
    return ''
  }
}
export function clearBindingIntent() {
  sessionStorage.removeItem(KEY)
}

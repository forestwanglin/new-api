import copy from './copy.json'

// Custom subscription copy is intentionally Chinese-only and independent of app i18n.
export function subscriptionCopy(
  key: string,
  values?: Record<string, string | number>
): string {
  let text = (copy as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(values ?? {})) {
    text = text.replaceAll(`{{${name}}}`, String(value))
  }
  return text
}

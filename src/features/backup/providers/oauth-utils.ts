export function resolveRedirectUri(configured: string | undefined): string {
  const explicit = String(configured ?? '').trim()
  if (explicit) return explicit
  const appUrl = String(import.meta.env.VITE_APP_URL ?? '').trim()
  if (appUrl) return `${appUrl.replace(/\/+$/, '')}/`
  return `${window.location.origin}/`
}

import type { ProviderId } from '../providers/types'

export interface PkcePair {
  verifier: string
  challenge: string
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return base64UrlEncode(buffer)
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = randomToken(64)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) }
}

export function makeState(provider: ProviderId): string {
  return `${provider}:${randomToken(16)}`
}

export interface OAuthResult {
  code: string
  state: string
}

interface OAuthMessage {
  type: 'scratch-oauth'
  provider: string
  code?: string
  error?: string
  errorDescription?: string
  state?: string
}

/**
 * Open the provider's consent page in a popup. The popup lands back on the app
 * origin, posts the code to this window, and closes itself.
 */
export function runOAuthPopup(provider: ProviderId, url: string, expectedState: string): Promise<OAuthResult> {
  return new Promise((resolve, reject) => {
    const popup = window.open(
      url,
      `scratch-oauth-${provider}`,
      'popup=yes,width=520,height=680',
    )
    if (!popup) {
      reject(new Error('浏览器拦截了授权弹窗，请允许弹窗后重试'))
      return
    }

    let settled = false
    let closedAt = 0
    const timeout = window.setTimeout(() => {
      finish(new Error('授权超时，请重试'))
    }, 180_000)

    const poll = window.setInterval(() => {
      if (popup.closed) {
        closedAt = closedAt || Date.now()
        if (Date.now() - closedAt > 1500) {
          finish(new Error('授权窗口已关闭，未完成授权'))
        }
      }
    }, 500)

    function finish(error: Error | null, result?: OAuthResult) {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      window.clearInterval(poll)
      window.removeEventListener('message', onMessage)
      if (error) reject(error)
      else if (result) resolve(result)
    }

    function onMessage(event: MessageEvent<OAuthMessage>) {
      if (event.origin !== window.location.origin) return
      const data = event.data
      if (!data || data.type !== 'scratch-oauth' || data.provider !== provider) return
      if (data.error) {
        finish(new Error(data.errorDescription || `授权失败：${data.error}`))
        return
      }
      if (!data.code) {
        finish(new Error('授权回调缺少 code'))
        return
      }
      if (data.state !== expectedState) {
        finish(new Error('授权回调的 state 不匹配，已拒绝'))
        return
      }
      try {
        popup?.close()
      } catch {
        // ignored
      }
      finish(null, { code: data.code, state: data.state })
    }

    window.addEventListener('message', onMessage)
  })
}

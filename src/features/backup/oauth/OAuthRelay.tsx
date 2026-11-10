import { useEffect, useState } from 'react'

/**
 * OAuth providers redirect back to the app origin with ?code=…&state=…. This
 * tiny page relays the result to the opener window without booting the whole
 * workspace inside the popup.
 */
export function OAuthRelay() {
  const [status, setStatus] = useState('正在完成授权…')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const state = params.get('state') ?? ''
    const provider = state.split(':')[0] ?? ''
    const message = {
      type: 'scratch-oauth',
      provider,
      code: params.get('code') ?? undefined,
      error: params.get('error') ?? undefined,
      errorDescription: params.get('error_description') ?? undefined,
      state,
    }
    try {
      window.opener?.postMessage(message, window.location.origin)
    } catch {
      // Opener may be gone.
    }
    const timer = window.setTimeout(() => {
      setStatus('授权结果已发送，可以关闭此窗口。')
      try {
        window.close()
      } catch {
        // Browsers may refuse; message remains.
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div className="flex h-full items-center justify-center bg-canvas p-6">
      <div className="rounded-xl border border-line bg-surface px-5 py-4 text-center">
        <p className="text-[13px] text-ink">{status}</p>
        <p className="mt-1 text-[11.5px] text-faint">Scratch 备份授权</p>
      </div>
    </div>
  )
}

import { useEffect } from 'react'

const STATIC_ICON = '/scratch-logo.png'
const WRITING_ICON = '/scratch-writing.gif'
const IDLE_MS = 1500

function isWritingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLInputElement) {
    const label = target.getAttribute('aria-label')
    return label === '草稿标题' || label === '重命名草稿'
  }
  return false
}

/**
 * Small easter egg: while the user is actively writing, the tab favicon plays
 * the pen animation; it settles back to the static mark after a short idle.
 */
export function useWritingFavicon(): void {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) return

    let idleTimer: number | null = null
    let writing = false
    let gifReady = false
    let gifApplied = false
    let gifRequest: HTMLImageElement | null = null

    const setIcon = (href: string, type: string) => {
      link.setAttribute('href', href)
      link.setAttribute('type', type)
    }

    const settle = () => {
      if (idleTimer !== null) {
        window.clearTimeout(idleTimer)
        idleTimer = null
      }
      writing = false
      if (gifApplied) {
        gifApplied = false
        setIcon(STATIC_ICON, 'image/png')
      }
    }

    const showWritingIcon = () => {
      if (!gifReady || gifApplied) return
      gifApplied = true
      setIcon(WRITING_ICON, 'image/gif')
    }

    // Warm the animation before swapping the tab icon so the favicon never
    // flickers through a missing image.
    const warmGif = () => {
      if (gifReady || gifRequest) return
      gifRequest = new Image()
      gifRequest.onload = () => {
        gifReady = true
        if (writing) showWritingIcon()
      }
      gifRequest.onerror = () => {
        gifRequest = null
      }
      gifRequest.src = WRITING_ICON
    }

    const onInput = (event: Event) => {
      if (!isWritingTarget(event.target)) return
      writing = true
      warmGif()
      showWritingIcon()
      if (idleTimer !== null) window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(settle, IDLE_MS)
    }

    document.addEventListener('input', onInput, true)
    return () => {
      document.removeEventListener('input', onInput, true)
      settle()
    }
  }, [])
}

import { create } from 'zustand'

export type ThemePref = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'scratch:theme'

export function readThemePref(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Private mode.
  }
  return 'system'
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref !== 'system') return pref
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

export function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = resolved
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#121310' : '#e6e9dd')
}

interface ThemeState {
  pref: ThemePref
  setPref: (pref: ThemePref) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  pref: readThemePref(),
  setPref: (pref) => {
    try {
      localStorage.setItem(STORAGE_KEY, pref)
    } catch {
      // Private mode.
    }
    set({ pref })
    applyResolvedTheme(resolveTheme(pref))
  },
}))

export function applyCurrentTheme(): void {
  applyResolvedTheme(resolveTheme(useThemeStore.getState().pref))
}

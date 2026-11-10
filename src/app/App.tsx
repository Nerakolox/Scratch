import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { WorkspaceProvider } from '@/features/workspace/WorkspaceContext'
import { ErrorBoundary } from './ErrorBoundary'
import { WorkspacePage } from './WorkspacePage'
import { SettingsPage } from './SettingsPage'
import { Toaster } from '@/shared/toast'
import { resolveTheme, useThemeStore } from '@/shared/theme'

function ThemeEffect() {
  const pref = useThemeStore((state) => state.pref)
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(pref)
      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) meta.setAttribute('content', resolveTheme(pref) === 'dark' ? '#161719' : '#f7f6f3')
    }
    apply()
    if (pref !== 'system' || !media) return
    media.addEventListener?.('change', apply)
    return () => media.removeEventListener?.('change', apply)
  }, [pref])
  return null
}

export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <WorkspaceProvider>
          <ThemeEffect />
          <Routes>
            <Route path="/" element={<WorkspacePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster />
        </WorkspaceProvider>
      </HashRouter>
    </ErrorBoundary>
  )
}

import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import { useDocumentService, useServiceState } from '@/features/workspace/WorkspaceContext'
import { Sidebar } from '@/features/scratches/Sidebar'
import { PaperEditor } from '@/features/paper/PaperEditor'
import { SearchPalette } from '@/features/search/SearchPalette'
import { TopBar } from './TopBar'
import { Button, Spinner } from '@/shared/ui'
import { useMediaQuery } from '@/shared/useMediaQuery'
import { toast } from '@/shared/toast'

const CanvasView = lazy(() => import('@/features/canvas/CanvasView'))

const SIDEBAR_KEY = 'scratch:sidebarCollapsed'

export function WorkspacePage() {
  const service = useDocumentService()
  const { session, conflict } = useServiceState()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1'
    } catch {
      return false
    }
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const isMobile = useMediaQuery('(max-width: 767px)')
  const mode = session.scratch?.activeMode ?? 'paper'
  const hasScratch = Boolean(session.scratch)

  const toggleSidebar = useCallback(() => {
    if (window.matchMedia('(max-width: 767px)').matches) {
      setMobileOpen((open) => !open)
      return
    }
    setCollapsed((value) => {
      const next = !value
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      } else if (mod && event.key.toLocaleLowerCase() === 'n') {
        event.preventDefault()
        void service.createScratch().catch(() => toast('新建草稿失败', 'error'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [service])

  useEffect(() => {
    if (!isMobile) setMobileOpen(false)
  }, [isMobile])

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <TopBar
        sidebarCollapsed={collapsed}
        onToggleSidebar={toggleSidebar}
        onOpenSearch={() => setPaletteOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/25 backdrop-blur-[1px] md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
        )}
        <div
          className={clsx(
            'fixed inset-y-0 left-0 z-40 transform transition-transform duration-200 md:static md:z-auto md:translate-x-0',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <Sidebar
            collapsed={isMobile ? false : collapsed}
            onToggleCollapse={toggleSidebar}
            onOpenSearch={() => setPaletteOpen(true)}
            onNavigate={() => setMobileOpen(false)}
          />
        </div>

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {conflict && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-warning/30 bg-warning/10 px-4 py-2 text-[12.5px] text-ink">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <AlertTriangle size={14} className="text-warning" aria-hidden />
                此草稿在另一个标签页中被更新。
              </span>
              <span className="text-muted">你的本地改动还在，请选择如何处理。</span>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void service.resolveConflict('reload')}
                >
                  放弃本地并加载
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void service.resolveConflict('overwrite')}
                >
                  保留本地并覆盖
                </Button>
              </div>
            </div>
          )}

          <div className="relative min-h-0 flex-1">
            {!hasScratch ? (
              <div className="flex h-full items-center justify-center text-[13px] text-faint">
                没有打开的草稿。
              </div>
            ) : mode === 'paper' ? (
              <PaperEditor key={session.scratch!.id} />
            ) : (
              <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner label="正在打开画布…" /></div>}>
                <CanvasView key={session.scratch!.id} />
              </Suspense>
            )}
          </div>
        </main>
      </div>

      <SearchPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}

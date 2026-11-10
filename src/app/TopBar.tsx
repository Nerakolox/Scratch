import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Check,
  FileText,
  LayoutGrid,
  Loader2,
  Menu,
  Search,
  Settings,
  XCircle,
} from 'lucide-react'
import { useDocumentService, useServiceState } from '@/features/workspace/WorkspaceContext'
import { IconButton, SegmentedControl } from '@/shared/ui'
import type { ScratchMode } from '@/core/models/types'

export function TopBar({
  onToggleSidebar,
  onOpenSearch,
}: {
  onToggleSidebar: () => void
  onOpenSearch: () => void
}) {
  const service = useDocumentService()
  const { session } = useServiceState()
  const navigate = useNavigate()
  const mode = session.scratch?.activeMode ?? 'paper'
  const title = session.scratch?.title.trim() || '未命名草稿'

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 px-4 md:px-5">
      <button
        type="button"
        onClick={onToggleSidebar}
        className="-ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-ink md:hidden"
        aria-label="打开草稿列表"
      >
        <Menu size={18} />
      </button>

      <span
        className="hidden min-w-0 truncate text-[13px] font-medium text-ink sm:inline"
        title={title}
      >
        {title}
      </span>
      <SaveIndicator />

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <SegmentedControl<ScratchMode>
          ariaLabel="编辑模式"
          value={mode}
          onChange={(next) => void service.setMode(next)}
          options={[
            { value: 'paper', label: '纸张', icon: <FileText size={13} /> },
            { value: 'canvas', label: '画布', icon: <LayoutGrid size={13} /> },
          ]}
        />
        <IconButton label="搜索草稿" size="sm" onClick={onOpenSearch} className="md:hidden">
          <Search size={16} />
        </IconButton>
        <IconButton label="设置与备份" size="sm" onClick={() => navigate('/settings')}>
          <Settings size={16} />
        </IconButton>
      </div>
    </header>
  )
}

function SaveIndicator() {
  const service = useDocumentService()
  const { status } = useServiceState()

  if (status.phase === 'idle') return <span className="hidden text-[11.5px] text-faint sm:inline" />

  const base =
    'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium whitespace-nowrap'

  if (status.phase === 'saving') {
    return (
      <span className={`${base} text-muted`} role="status" aria-label="正在保存">
        <Loader2 size={12} className="animate-spin" aria-hidden />
        <span className="hidden sm:inline">保存中</span>
      </span>
    )
  }
  if (status.phase === 'error') {
    return (
      <button
        type="button"
        className={`${base} text-danger hover:bg-danger-soft`}
        onClick={() => void service.flush()}
        title={status.message ?? '保存失败'}
      >
        <XCircle size={13} aria-hidden />
        <span className="hidden sm:inline">保存失败，重试</span>
      </button>
    )
  }
  if (status.phase === 'conflict') {
    return (
      <span className={`${base} text-warning`} role="status" aria-label="存在待处理的跨标签更新" title={status.message}>
        <AlertTriangle size={13} aria-hidden />
        <span className="hidden sm:inline">待处理更新</span>
      </span>
    )
  }
  return (
    <span className={`${base} text-faint`} role="status" aria-label="所有更改已保存到本地" title="所有更改已保存到本地">
      <Check size={13} aria-hidden />
      <span className="hidden sm:inline">已保存</span>
    </span>
  )
}

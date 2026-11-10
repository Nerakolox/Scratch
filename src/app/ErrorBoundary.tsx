import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryState {
  failed: boolean
}

/**
 * Keeps a rendering crash from presenting a blank page. Local data is already
 * persisted in IndexedDB, so the safe recovery path is a reload.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Deliberately do not log note content or credentials from error payloads.
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex h-full items-center justify-center bg-canvas p-6">
        <div className="max-w-sm rounded-xl border border-line bg-surface p-6 text-center">
          <h1 className="text-[15px] font-semibold text-ink">界面遇到错误</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            你的草稿仍保存在本浏览器中。重新加载通常可以恢复；若持续出现，请先不要清除站点数据，并在可用时导出备份。
          </p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-accent-ink hover:opacity-90"
            onClick={() => window.location.reload()}
          >
            重新加载 Scratch
          </button>
        </div>
      </div>
    )
  }
}

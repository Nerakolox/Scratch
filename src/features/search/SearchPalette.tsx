import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CornerDownLeft, FileText, Search } from 'lucide-react'
import type { ScratchSearchResult } from '@/core/models/types'
import { useDocumentService, useServiceState } from '@/features/workspace/WorkspaceContext'
import { Kbd } from '@/shared/ui'
import { formatRelativeTime } from '@/shared/format'

export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const service = useDocumentService()
  const { scratches } = useServiceState()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ScratchSearchResult[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestId = useRef(0)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setActiveIndex(0)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const trimmed = query.trim()
    if (!trimmed) {
      setLoading(false)
      setResults([])
      setActiveIndex(0)
      return
    }
    const id = ++requestId.current
    setLoading(true)
    const timer = window.setTimeout(() => {
      service
        .searchScratches(trimmed)
        .then((found) => {
          if (requestId.current !== id) return
          setResults(found)
          setActiveIndex(0)
          setLoading(false)
        })
        .catch(() => {
          if (requestId.current === id) {
            setResults([])
            setLoading(false)
          }
        })
    }, 140)
    return () => window.clearTimeout(timer)
  }, [query, service, open])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const recents = scratches.slice(0, 8)
  const items: Array<{ id: string; title: string; snippet: string; updatedAt: number }> =
    query.trim()
      ? results.map((result) => ({
          id: result.scratch.id,
          title: result.scratch.title || '未命名草稿',
          snippet: result.snippet,
          updatedAt: result.scratch.updatedAt,
        }))
      : recents.map((scratch) => ({
          id: scratch.id,
          title: scratch.title || '未命名草稿',
          snippet: '',
          updatedAt: scratch.updatedAt,
        }))

  const choose = (id: string) => {
    void service.openScratch(id).catch(() => undefined)
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px] motion-fade" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="搜索草稿"
        className="relative w-full max-w-[560px] overflow-hidden rounded-xl border border-line bg-elevated shadow-xl motion-panel"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="text-faint" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((index) => (items.length ? (index + 1) % items.length : 0))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((index) =>
                  items.length ? (index - 1 + items.length) % items.length : 0,
                )
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const item = items[activeIndex] ?? items[0]
                if (item) choose(item.id)
              }
            }}
            placeholder="搜索标题与正文…"
            aria-label="搜索草稿"
            className="h-12 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div className="max-h-[46vh] overflow-y-auto p-1.5" role="listbox">
          {!query.trim() && (
            <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-medium uppercase tracking-[0.07em] text-faint">
              最近草稿
            </div>
          )}
          {loading ? (
            <div className="px-3 py-4 text-[12.5px] text-faint">正在搜索…</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12.5px] text-faint">
              {query.trim() ? '没有找到匹配的草稿。' : '还没有草稿。'}
            </div>
          ) : (
            items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(item.id)}
                className={`flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left ${
                  index === activeIndex ? 'bg-sunken' : 'hover:bg-sunken/60'
                }`}
              >
                <FileText size={15} className="mt-0.5 shrink-0 text-faint" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {item.title}
                  </span>
                  {item.snippet && (
                    <span className="mt-0.5 block truncate text-[11.5px] text-muted">
                      {item.snippet}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2 pt-0.5 text-[10.5px] text-faint">
                  {formatRelativeTime(item.updatedAt)}
                  {index === activeIndex && <CornerDownLeft size={12} />}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

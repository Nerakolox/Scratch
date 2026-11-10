import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  FilePlus2,
  MoreHorizontal,
  PanelLeftClose,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import type { Scratch } from '@/core/models/types'
import { useDocumentService, useServiceState } from '@/features/workspace/WorkspaceContext'
import { Button, IconButton, Kbd, Dialog, inputClass } from '@/shared/ui'
import { formatRelativeTime } from '@/shared/format'
import { toast } from '@/shared/toast'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  onOpenSearch: () => void
  onNavigate: () => void
}

export function Sidebar({ collapsed, onToggleCollapse, onOpenSearch, onNavigate }: SidebarProps) {
  const service = useDocumentService()
  const { session, scratches, trashed } = useServiceState()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Scratch | null>(null)
  const [creating, setCreating] = useState(false)
  const [brandActive, setBrandActive] = useState(false)
  const [brandReady, setBrandReady] = useState(false)
  const [brandMounted, setBrandMounted] = useState(false)
  const [brandPlay, setBrandPlay] = useState(0)
  const brandHoverRef = useRef(false)
  const brandRequestRef = useRef<HTMLImageElement | null>(null)
  const brandHideTimer = useRef<number | null>(null)
  const brandImgRef = useRef<HTMLImageElement | null>(null)

  const startBrand = () => {
    if (brandHideTimer.current !== null) {
      window.clearTimeout(brandHideTimer.current)
      brandHideTimer.current = null
    }
    setBrandMounted(true)
    setBrandPlay((count) => count + 1)
  }

  // The hover clip is the loop rotated to begin on the static logo frame, so
  // every hover starts from the same image. It is fetched once and replayed by
  // remounting the image.
  const warmBrandAnimation = () => {
    if (brandReady || brandRequestRef.current) return
    const image = new Image()
    brandRequestRef.current = image
    image.onload = () => {
      image.decode().catch(() => undefined).finally(() => {
        setBrandReady(true)
        if (brandHoverRef.current) startBrand()
      })
    }
    image.onerror = () => {
      brandRequestRef.current = null
    }
    image.src = '/scratch-writing-hover.webp'
  }

  const enterBrand = () => {
    brandHoverRef.current = true
    warmBrandAnimation()
    if (brandReady) startBrand()
  }

  const leaveBrand = () => {
    brandHoverRef.current = false
    setBrandActive(false)
    if (brandHideTimer.current !== null) window.clearTimeout(brandHideTimer.current)
    brandHideTimer.current = window.setTimeout(() => {
      setBrandMounted(false)
      brandHideTimer.current = null
    }, 220)
  }

  useLayoutEffect(() => {
    if (!brandMounted) return
    if (brandImgRef.current?.complete && brandHoverRef.current) setBrandActive(true)
  }, [brandMounted, brandPlay])

  useEffect(() => {
    return () => {
      if (brandHideTimer.current !== null) window.clearTimeout(brandHideTimer.current)
    }
  }, [])

  if (collapsed) {
    return (
      <aside className="hidden h-full w-[56px] shrink-0 flex-col items-center gap-2 overflow-hidden rounded-panel bg-surface py-2.5 shadow-panel transition-[width] duration-300 ease-smooth md:flex">
        <div
          key="collapsed"
          className="motion-fade flex w-full flex-1 flex-col items-center gap-2"
        >
          <IconButton label="展开侧栏" size="sm" onClick={onToggleCollapse}>
            <PanelLeftClose size={16} className="rotate-180" />
          </IconButton>
          <IconButton
            label="新建草稿"
            size="sm"
            onClick={() => {
              setCreating(true)
              void service
                .createScratch()
                .catch((error: unknown) =>
                  toast(error instanceof Error ? error.message : '新建草稿失败', 'error'),
                )
                .finally(() => setCreating(false))
            }}
          >
            <FilePlus2 size={16} />
          </IconButton>
          <IconButton label="搜索草稿" size="sm" onClick={onOpenSearch}>
            <Search size={16} />
          </IconButton>
          <div className="flex-1" />
        </div>
      </aside>
    )
  }

  const beginRename = (scratch: Scratch) => {
    setMenuId(null)
    setRenamingId(scratch.id)
    setRenameDraft(scratch.title)
  }

  const commitRename = (scratch: Scratch) => {
    const value = renameDraft.trim()
    setRenamingId(null)
    if (value !== scratch.title) void service.renameScratch(scratch.id, value)
  }

  return (
    <aside className="flex h-full w-[252px] shrink-0 flex-col overflow-hidden rounded-panel bg-surface shadow-panel transition-[width] duration-300 ease-smooth">
      <div key="expanded" className="motion-fade-delayed flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
        <span
          className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center"
          aria-hidden
          onMouseEnter={enterBrand}
          onMouseLeave={leaveBrand}
        >
          <img
            src="/scratch-logo.png"
            alt=""
            className={clsx(
              'brand-image h-8 w-8 object-contain transition-opacity duration-200',
              brandActive && 'opacity-0',
            )}
            draggable={false}
          />
          {brandMounted && (
            <img
              key={brandPlay}
              ref={brandImgRef}
              src="/scratch-writing-hover.webp"
              alt=""
              onLoad={() => {
                if (brandHoverRef.current) setBrandActive(true)
              }}
              className={clsx(
                'brand-image pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity duration-200',
                brandActive ? 'opacity-100' : 'opacity-0',
              )}
              draggable={false}
            />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold tracking-tight">Scratch</div>
          <div className="text-[10px] uppercase tracking-[0.08em] text-faint">Duskbit Studio</div>
        </div>
        <IconButton
          label="收起侧栏"
          size="sm"
          onClick={onToggleCollapse}
          className="max-md:hidden"
        >
          <PanelLeftClose size={16} />
        </IconButton>
        <IconButton
          label="关闭草稿列表"
          size="sm"
          onClick={onToggleCollapse}
          className="md:hidden"
        >
          <X size={15} />
        </IconButton>
      </div>

      <div className="space-y-1.5 px-4 pb-3 pt-1">
        <Button
          variant="primary"
          size="md"
          className="w-full justify-start"
          loading={creating}
          icon={<FilePlus2 size={15} />}
          onClick={() => {
            setCreating(true)
            void service
              .createScratch()
              .catch((error: unknown) =>
                toast(error instanceof Error ? error.message : '新建草稿失败', 'error'),
              )
              .finally(() => setCreating(false))
          }}
        >
          新草稿
        </Button>
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex h-8 w-full items-center gap-2 rounded-lg border border-transparent bg-sunken/60 px-3 text-[12.5px] text-faint transition-colors hover:bg-sunken hover:text-muted"
        >
          <Search size={14} />
          <span className="flex-1 text-left">搜索草稿</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="px-3 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-[0.07em] text-faint">
          最近草稿
        </div>
        {scratches.length === 0 ? (
          <p className="px-3 py-3 text-[12px] leading-relaxed text-faint">还没有草稿。</p>
        ) : (
          <ul className="space-y-0.5">
            {scratches.map((scratch) => {
              const active = session.scratch?.id === scratch.id
              const renaming = renamingId === scratch.id
              return (
                <li key={scratch.id} className="group relative motion-fade">
                  {renaming ? (
                    <div className="px-1 py-1">
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onBlur={() => commitRename(scratch)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            commitRename(scratch)
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setRenamingId(null)
                          }
                        }}
                        className={clsx(inputClass, 'h-8 text-[12.5px]')}
                        aria-label="重命名草稿"
                      />
                    </div>
                  ) : (
                    <div
                      className={clsx(
                        'flex items-stretch rounded-lg transition-colors duration-200',
                        active ? 'bg-accent-soft' : 'hover:bg-sunken/60',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          void service.openScratch(scratch.id).catch((error: unknown) => {
                            toast(error instanceof Error ? error.message : '无法打开草稿', 'error')
                          })
                          onNavigate()
                        }}
                        className="min-w-0 flex-1 rounded-lg px-3 py-1.5 text-left"
                      >
                        <span
                          className={clsx(
                            'block truncate text-[13px]',
                            active ? 'font-medium text-ink' : 'text-ink/90',
                          )}
                        >
                          {scratch.title || '未命名草稿'}
                        </span>
                        <span className="mt-0.5 block truncate text-[10.5px] text-faint">
                          {formatRelativeTime(scratch.updatedAt)}
                          {scratch.activeMode === 'canvas' ? ' · 画布' : ''}
                        </span>
                      </button>
                      <div className="flex items-center pr-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                        <IconButton
                          label="草稿操作"
                          size="sm"
                          onClick={() => setMenuId(menuId === scratch.id ? null : scratch.id)}
                        >
                          <MoreHorizontal size={15} />
                        </IconButton>
                      </div>
                    </div>
                  )}
                  {menuId === scratch.id && (
                    <ScratchMenu
                      onClose={() => setMenuId(null)}
                      onRename={() => beginRename(scratch)}
                      onTrash={() => {
                        setMenuId(null)
                        void service
                          .trashScratch(scratch.id)
                          .then(() => toast('已移到回收站'))
                          .catch((error: unknown) =>
                            toast(
                              error instanceof Error ? error.message : '移到回收站失败',
                              'error',
                            ),
                          )
                      }}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <div className="mt-4 pt-2">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-[11.5px] font-medium text-muted hover:bg-sunken hover:text-ink"
            onClick={() => setTrashOpen((open) => !open)}
            aria-expanded={trashOpen}
          >
            <Trash2 size={13} />
            <span className="flex-1 text-left">回收站</span>
            {trashed.length > 0 && (
              <span className="rounded-full bg-sunken px-1.5 text-[10.5px] text-faint">
                {trashed.length}
              </span>
            )}
            <ChevronDown
              size={13}
              className={clsx('transition-transform', !trashOpen && '-rotate-90')}
            />
          </button>
          {trashOpen && (
            <ul className="mt-1 space-y-0.5 motion-fade">
              {trashed.length === 0 ? (
                <li className="px-3 py-2 text-[11.5px] text-faint">回收站是空的。</li>
              ) : (
                trashed.map((scratch) => (
                  <li
                    key={scratch.id}
                    className="flex items-center gap-1 rounded-md px-3 py-1.5 hover:bg-sunken/60"
                  >
                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted line-through decoration-line-strong">
                      {scratch.title || '未命名草稿'}
                    </span>
                    <IconButton
                      label="恢复草稿"
                      size="sm"
                      onClick={() => {
                        void service.restoreScratch(scratch.id).then(() => toast('已恢复草稿', 'success'))
                      }}
                    >
                      <RotateCcw size={13} />
                    </IconButton>
                    <IconButton
                      label="永久删除"
                      size="sm"
                      onClick={() => setDeleteTarget(scratch)}
                    >
                      <X size={13} />
                    </IconButton>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      </div>
      </div>

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="永久删除此草稿？"
        description="草稿内容、图片和画布布局将被删除，且无法恢复。"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                const target = deleteTarget
                setDeleteTarget(null)
                if (!target) return
                void service.deleteScratchPermanently(target.id).then(() => {
                  toast('已永久删除', 'success')
                })
              }}
            >
              永久删除
            </Button>
          </>
        }
      />
    </aside>
  )
}

function ScratchMenu({
  onClose,
  onRename,
  onTrash,
}: {
  onClose: () => void
  onRename: () => void
  onTrash: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handlePointer(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', handlePointer, true)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('pointerdown', handlePointer, true)
      window.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute right-1 top-9 z-20 w-36 overflow-hidden rounded-lg border border-line bg-elevated p-1.5 shadow-md motion-menu"
      role="menu"
    >
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[12.5px] text-ink hover:bg-sunken"
        onClick={onRename}
      >
        重命名
      </button>
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[12.5px] text-danger hover:bg-danger-soft"
        onClick={onTrash}
      >
        移到回收站
      </button>
    </div>
  )
}

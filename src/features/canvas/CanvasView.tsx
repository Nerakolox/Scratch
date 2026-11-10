import 'tldraw/tldraw.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Tldraw,
  type Editor,
  type TLShapeId,
  type TLStoreSnapshot,
  type TLUiComponents,
} from 'tldraw'
import { Eye, Focus, Plus, SlidersHorizontal, SquarePen, Trash2, Undo2 } from 'lucide-react'
import { useDocumentService, useServiceState } from '@/features/workspace/WorkspaceContext'
import { Button, Dialog } from '@/shared/ui'
import { toast } from '@/shared/toast'
import { useThemeStore } from '@/shared/theme'
import {
  BlockCardShapeUtil,
  CARD_GAP,
  DEFAULT_CARD_HEIGHT,
  DEFAULT_CARD_WIDTH,
  EDIT_CARD_EVENT,
  type BlockCardShape,
} from './BlockCardShape'
import { CardEditorOverlay, type CardRect } from './CardEditorOverlay'
import { CanvasSettingsPanel } from './CanvasSettingsPanel'
import {
  readCanvasPreferences,
  writeCanvasPreferences,
  type CanvasPreferences,
} from './canvas-preferences'

interface CardSelection {
  shapeId: TLShapeId
  blockId: string
}

interface StoredCanvasSession {
  camera?: { x: number; y: number; z: number }
}

function cardShapes(editor: Editor): BlockCardShape[] {
  return editor
    .getCurrentPageShapes()
    .filter((shape) => shape.type === 'block-card') as BlockCardShape[]
}

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return !(
    a.x + a.w + CARD_GAP <= b.x ||
    b.x + b.w + CARD_GAP <= a.x ||
    a.y + a.h + CARD_GAP <= b.y ||
    b.y + b.h + CARD_GAP <= a.y
  )
}

function findFreeSpot(editor: Editor, startIndex: number): { x: number; y: number } {
  const existing = cardShapes(editor)
    .map((shape) => editor.getShapePageBounds(shape))
    .filter((bounds): bounds is NonNullable<typeof bounds> => Boolean(bounds))
  const columns = 4
  for (let i = 0; i < 400; i += 1) {
    const slot = (startIndex + i) % 400
    const column = slot % columns
    const row = Math.floor(slot / columns)
    const candidate = {
      x: column * (DEFAULT_CARD_WIDTH + CARD_GAP),
      y: row * (DEFAULT_CARD_HEIGHT + CARD_GAP),
      w: DEFAULT_CARD_WIDTH,
      h: DEFAULT_CARD_HEIGHT,
    }
    if (!existing.some((bounds) => overlaps(candidate, bounds))) {
      return { x: candidate.x, y: candidate.y }
    }
  }
  return {
    x: (startIndex % columns) * (DEFAULT_CARD_WIDTH + CARD_GAP),
    y: Math.floor(startIndex / columns) * (DEFAULT_CARD_HEIGHT + CARD_GAP),
  }
}

export default function CanvasView() {
  const service = useDocumentService()
  const state = useServiceState()
  const themePref = useThemeStore((store) => store.pref)
  const stateRef = useRef(state)
  stateRef.current = state
  const scratchIdRef = useRef(state.session.scratch?.id ?? null)
  scratchIdRef.current = state.session.scratch?.id ?? null

  const editorRef = useRef<Editor | null>(null)
  const [ready, setReady] = useState(false)
  const [selected, setSelected] = useState<CardSelection[]>([])
  const [editing, setEditing] = useState<{ blockId: string; rect: CardRect } | null>(null)
  const editingRef = useRef<string | null>(null)
  editingRef.current = editing?.blockId ?? null
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addingCard, setAddingCard] = useState(false)
  const [preferences, setPreferences] = useState<CanvasPreferences>(() =>
    readCanvasPreferences(),
  )
  const preferencesRef = useRef(preferences)
  preferencesRef.current = preferences
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsWrapperRef = useRef<HTMLDivElement>(null)

  const lastSeenRef = useRef<Set<string>>(new Set())
  const programmaticRef = useRef<Set<string>>(new Set())
  const saveTimerRef = useRef<number | null>(null)
  const cleanupsRef = useRef<Array<() => void>>([])

  const hiddenCount = state.session.canvas?.hiddenBlockIds.length ?? 0

  const updatePreferences = useCallback((patch: Partial<CanvasPreferences>) => {
    setPreferences((previous) => {
      const next = { ...previous, ...patch }
      writeCanvasPreferences(next)
      return next
    })
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !ready) return
    editor.user.updateUserPreferences({ isSnapMode: preferences.alwaysSnap })
  }, [preferences.alwaysSnap, ready])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !ready) return
    editor.updateInstanceState({ isGridMode: preferences.showGrid })
  }, [preferences.showGrid, ready])

  useEffect(() => {
    if (!ready) return
    let open: boolean
    try {
      open = localStorage.getItem('minimap') === 'false'
    } catch {
      open = false
    }
    if (open !== preferences.showMinimap) {
      // tldraw's NavigationPanel owns the minimap collapse state; drive its own
      // toggle so our setting stays the single source of truth.
      document
        .querySelector<HTMLButtonElement>('[data-testid="minimap.toggle-button"]')
        ?.click()
    }
  }, [preferences.showMinimap, ready])

  useEffect(() => {
    if (!settingsOpen) return
    function handlePointer(event: PointerEvent) {
      if (
        settingsWrapperRef.current &&
        !settingsWrapperRef.current.contains(event.target as Node)
      ) {
        setSettingsOpen(false)
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setSettingsOpen(false)
    }
    document.addEventListener('pointerdown', handlePointer, true)
    document.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointer, true)
      document.removeEventListener('keydown', handleKey, true)
    }
  }, [settingsOpen])

  const toggleSettings = useCallback(() => {
    if (settingsOpen) {
      setSettingsOpen(false)
      return
    }
    const editor = editorRef.current
    if (editor) {
      let minimapOpen: boolean
      try {
        minimapOpen = localStorage.getItem('minimap') === 'false'
      } catch {
        minimapOpen = false
      }
      const synced: CanvasPreferences = {
        ...preferencesRef.current,
        showMinimap: minimapOpen,
        alwaysSnap: editor.user.getIsSnapMode(),
        showGrid: editor.getInstanceState().isGridMode,
      }
      setPreferences(synced)
      writeCanvasPreferences(synced)
    }
    setSettingsOpen(true)
  }, [settingsOpen])

  const flushCanvas = useCallback(async () => {
    const editor = editorRef.current
    const scratchId = scratchIdRef.current
    if (!editor || !scratchId) return
    const snapshot = editor.store.getStoreSnapshot()
    const camera = editor.getCamera()
    await service.saveCanvas(snapshot, { camera }, scratchId)
  }, [service])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void flushCanvas()
    }, 350)
  }, [flushCanvas])

  const detectRemovedCards = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const present = new Set(cardShapes(editor).map((shape) => shape.props.blockId))
    const session = stateRef.current.session
    const hidden = session.canvas?.hiddenBlockIds ?? []

    for (const blockId of lastSeenRef.current) {
      if (present.has(blockId)) continue
      if (programmaticRef.current.has(blockId)) {
        programmaticRef.current.delete(blockId)
        continue
      }
      if (
        session.blocks.some((block) => block.id === blockId) &&
        !hidden.includes(blockId)
      ) {
        void service.hideBlock(blockId)
        toast('已从画布隐藏卡片，内容仍保留在纸张中')
      }
    }
    for (const blockId of present) {
      programmaticRef.current.delete(blockId)
      if (!lastSeenRef.current.has(blockId) && hidden.includes(blockId)) {
        void service.unhideBlock(blockId)
      }
    }
    lastSeenRef.current = present
  }, [service])

  const reconcile = useCallback(
    (session = stateRef.current.session) => {
      const editor = editorRef.current
      if (!editor) return
      const allShapes = cardShapes(editor)
      const seenBlocks = new Set<string>()
      const duplicates: BlockCardShape[] = []
      for (const shape of allShapes) {
        if (seenBlocks.has(shape.props.blockId)) duplicates.push(shape)
        else seenBlocks.add(shape.props.blockId)
      }
      if (duplicates.length > 0) {
        // A Block can only have one content card per scratch; extra copies from
        // paste/undo are removed without hiding the surviving card.
        editor.deleteShapes(duplicates.map((shape) => shape.id))
      }
      const shapes = allShapes.filter((shape) => !duplicates.includes(shape))
      const blockIds = new Set(session.blocks.map((block) => block.id))
      const hidden = new Set(session.canvas?.hiddenBlockIds ?? [])
      const present = new Map(shapes.map((shape) => [shape.props.blockId, shape]))

      const orphans = shapes.filter((shape) => !blockIds.has(shape.props.blockId))
      if (orphans.length > 0) {
        for (const shape of orphans) programmaticRef.current.add(shape.props.blockId)
        editor.deleteShapes(orphans.map((shape) => shape.id))
      }

      for (const shape of shapes) {
        if (blockIds.has(shape.props.blockId) && hidden.has(shape.props.blockId)) {
          void service.unhideBlock(shape.props.blockId)
        }
      }

      let added = 0
      for (const block of session.blocks) {
        if (hidden.has(block.id) || present.has(block.id)) continue
        const spot = findFreeSpot(editor, shapes.length + added)
        editor.createShape<BlockCardShape>({
          type: 'block-card',
          x: spot.x,
          y: spot.y,
          props: {
            w: DEFAULT_CARD_WIDTH,
            h: DEFAULT_CARD_HEIGHT,
            blockId: block.id,
          },
        })
        added += 1
      }

      lastSeenRef.current = new Set(cardShapes(editor).map((shape) => shape.props.blockId))
    },
    [service],
  )

  const closeEditor = useCallback(() => {
    setEditing(null)
  }, [])

  const openEditorForShape = useCallback((shapeId: TLShapeId, blockId: string) => {
    const editor = editorRef.current
    if (!editor) return
    const shape = editor.getShape(shapeId)
    if (!shape) return
    const bounds = editor.getShapePageBounds(shape)
    if (!bounds) return
    const topLeft = editor.pageToScreen({ x: bounds.x, y: bounds.y })
    const bottomRight = editor.pageToScreen({ x: bounds.maxX, y: bounds.maxY })
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const width = Math.min(
      Math.max(320, bottomRight.x - topLeft.x),
      560,
      viewportWidth - 24,
    )
    const height = Math.min(
      Math.max(240, bottomRight.y - topLeft.y),
      520,
      viewportHeight - 24,
    )
    const left = Math.max(12, Math.min(topLeft.x, viewportWidth - width - 12))
    const top = Math.max(12, Math.min(topLeft.y, viewportHeight - height - 12))
    setEditing({ blockId, rect: { left, top, width, height } })
  }, [])

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor
      const canvas = stateRef.current.session.canvas
      if (canvas?.snapshot) {
        try {
          editor.store.loadStoreSnapshot(canvas.snapshot as TLStoreSnapshot)
        } catch {
          toast('画布布局快照无法读取，已按纸张内容重建', 'error')
        }
      }
      const sessionState = canvas?.sessionState as StoredCanvasSession | undefined
      if (sessionState?.camera) {
        try {
          editor.setCamera(sessionState.camera)
        } catch {
          // Invalid stored camera: keep default.
        }
      }
      editor.setColorMode(
        document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
      )
      editor.user.updateUserPreferences({
        isSnapMode: preferencesRef.current.alwaysSnap,
      })
      editor.updateInstanceState({ isGridMode: preferencesRef.current.showGrid })
      reconcile()

      const unsubscribeDocument = editor.store.listen(
        () => {
          scheduleSave()
          detectRemovedCards()
        },
        { scope: 'document' },
      )
      let lastCamera = editor.getCamera()
      const unsubscribeSession = editor.store.listen(
        () => {
          const shapes = editor
            .getSelectedShapes()
            .filter((shape) => shape.type === 'block-card') as BlockCardShape[]
          setSelected(
            shapes.map((shape) => ({ shapeId: shape.id, blockId: shape.props.blockId })),
          )
          const camera = editor.getCamera()
          const cameraChanged =
            camera.x !== lastCamera.x ||
            camera.y !== lastCamera.y ||
            camera.z !== lastCamera.z
          lastCamera = camera
          if (cameraChanged && editingRef.current) setEditing(null)
        },
        { scope: 'session' },
      )
      const unregisterFlusher = service.registerCanvasFlusher(flushCanvas)
      cleanupsRef.current.push(unsubscribeDocument, unsubscribeSession, unregisterFlusher)
      setReady(true)
    },
    [detectRemovedCards, flushCanvas, reconcile, scheduleSave, service],
  )

  useEffect(() => {
    if (!ready) return
    reconcile(state.session)
  }, [ready, state.session, reconcile])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.setColorMode(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  }, [themePref, ready])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ shapeId: TLShapeId; blockId: string }>).detail
      if (!detail?.shapeId) return
      openEditorForShape(detail.shapeId, detail.blockId)
    }
    window.addEventListener(EDIT_CARD_EVENT, handler)
    return () => window.removeEventListener(EDIT_CARD_EVENT, handler)
  }, [openEditorForShape])

  useEffect(() => {
    function handleResize() {
      setEditing(null)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      for (const cleanup of cleanupsRef.current) cleanup()
      cleanupsRef.current = []
      editorRef.current = null
      void flushCanvas()
    }
  }, [flushCanvas])

  const addCard = useCallback(
    async (kind: 'richtext' | 'code') => {
      const editor = editorRef.current
      if (!editor) return
      setAddingCard(true)
      try {
        const blockId = await service.addBlockFromCanvas(kind)
        const existing = cardShapes(editor).find((shape) => shape.props.blockId === blockId)
        const center = editor.screenToPage({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        })
        const x = center.x - DEFAULT_CARD_WIDTH / 2
        const y = center.y - DEFAULT_CARD_HEIGHT / 2
        if (existing) {
          editor.updateShape({ id: existing.id, type: 'block-card', x, y })
        } else {
          editor.createShape<BlockCardShape>({
            type: 'block-card',
            x,
            y,
            props: { w: DEFAULT_CARD_WIDTH, h: DEFAULT_CARD_HEIGHT, blockId },
          })
        }
        editor.selectNone()
      } catch (error) {
        toast(error instanceof Error ? error.message : '无法新建卡片', 'error')
      } finally {
        setAddingCard(false)
      }
    },
    [service],
  )

  const hideSelected = useCallback(() => {
    const editor = editorRef.current
    if (!editor || selected.length === 0) return
    for (const item of selected) programmaticRef.current.add(item.blockId)
    editor.deleteShapes(selected.map((item) => item.shapeId))
    for (const item of selected) void service.hideBlock(item.blockId)
    setSelected([])
    toast('已从画布隐藏，可在右上角恢复', 'success')
  }, [selected, service])

  const deleteSelected = useCallback(() => {
    if (selected.length === 0) return
    for (const item of selected) void service.deleteBlock(item.blockId)
    setSelected([])
    setConfirmDelete(false)
    toast('已删除卡片内容', 'success')
  }, [selected, service])

  const restoreHidden = useCallback(() => {
    void service.showAllHiddenBlocks()
  }, [service])

  const componentOverrides: TLUiComponents = {
    SharePanel: null,
    PeopleMenu: null,
    DebugPanel: null,
    DebugMenu: null,
    ...(preferences.showCanvasMenu ? {} : { TopPanel: null, MenuPanel: null }),
    ...(preferences.showStylePanel ? {} : { StylePanel: null }),
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      <div className="absolute inset-0">
        <Tldraw
          licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY || undefined}
          shapeUtils={[BlockCardShapeUtil]}
          onMount={handleMount}
          options={{ createTextOnCanvasDoubleClick: false }}
          components={componentOverrides}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center p-3">
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-line bg-elevated/95 p-1 shadow-sm backdrop-blur">
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus size={14} />}
            loading={addingCard}
            onClick={() => void addCard('richtext')}
          >
            文本卡片
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void addCard('code')}
            title="新建代码卡片"
          >
            代码卡片
          </Button>
          {hiddenCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Undo2 size={14} />}
              onClick={restoreHidden}
              title="恢复在本画布隐藏的卡片"
            >
              恢复隐藏 ({hiddenCount})
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon={<Focus size={14} />}
            onClick={() => editorRef.current?.zoomToFit()}
          >
            适应视图
          </Button>
          <div ref={settingsWrapperRef} className="relative">
            <Button
              size="sm"
              variant={settingsOpen ? 'secondary' : 'ghost'}
              icon={<SlidersHorizontal size={14} />}
              aria-label="画布设置"
              title="画布设置"
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
              onClick={toggleSettings}
            />
            {settingsOpen && (
              <CanvasSettingsPanel
                preferences={preferences}
                onChange={updatePreferences}
                onClose={() => setSettingsOpen(false)}
              />
            )}
          </div>
        </div>
      </div>

      {selected.length > 0 && !settingsOpen && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-line bg-elevated/95 p-1 shadow-sm backdrop-blur">
            <span className="px-2 text-[11.5px] text-faint">已选 {selected.length} 张</span>
            {selected.length === 1 && (
              <Button
                size="sm"
                variant="secondary"
                icon={<SquarePen size={13} />}
                onClick={() => {
                  const item = selected[0]
                  openEditorForShape(item.shapeId, item.blockId)
                }}
              >
                编辑
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon={<Eye size={13} />}
              onClick={hideSelected}
              title="只从画布隐藏，纸张内容保留"
            >
              隐藏
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={13} />}
              className="text-danger hover:bg-danger-soft"
              onClick={() => setConfirmDelete(true)}
            >
              删除内容
            </Button>
          </div>
        </div>
      )}

      {editing && (
        <CardEditorOverlay
          blockId={editing.blockId}
          rect={editing.rect}
          onClose={closeEditor}
        />
      )}

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="删除卡片内容？"
        description="这会把对应的块从纸张和画布中一起删除，无法撤销（画布隐藏请用“隐藏”）。"
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              取消
            </Button>
            <Button size="sm" variant="danger" onClick={deleteSelected}>
              删除内容
            </Button>
          </>
        }
      />
    </div>
  )
}

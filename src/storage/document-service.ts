import type {
  CanvasLayoutRecord,
  ConflictInfo,
  ContentBlock,
  Dataset,
  ID,
  Scratch,
  ScratchMode,
  SaveStatus,
  SessionSnapshot,
  TipTapNode,
} from '@/core/models/types'
import {
  createCodeBlockNode,
  createParagraphNode,
  isNodeMeaningful,
  nodeKind,
  titleCandidateFromDoc,
  withBlockId,
  getBlockId,
} from '@/core/content'
import { newId } from '@/core/utils'
import {
  ConflictError,
  NotFoundError,
  type LoadedSession,
  type ScratchRepository,
} from './repository'

export interface ServiceState {
  ready: boolean
  session: SessionSnapshot
  scratches: Scratch[]
  trashed: Scratch[]
  status: SaveStatus
  conflict: ConflictInfo | null
  /** Bumped whenever content was replaced from outside this session. */
  externalEpoch: number
}

interface InternalSession {
  scratch: Scratch
  blocks: Map<ID, ContentBlock>
  order: ID[]
  canvas: CanvasLayoutRecord
}

interface BroadcastSaved {
  type: 'saved'
  scratchId: string
  revision: number
  source: string
}

const EMPTY_SESSION: SessionSnapshot = {
  scratch: null,
  blocks: [],
  order: [],
  canvas: null,
  externalEpoch: 0,
}

const LAST_SCRATCH_KEY = 'scratch:lastScratchId'
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const SAVE_DEBOUNCE_MS = 500
const SAVE_MAX_DELAY_MS = 2000
const HISTORY_INTERVAL_MS = 5 * 60 * 1000

function sameOrder(a: ID[], b: ID[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export class DocumentService {
  private readonly instanceId = newId()
  private session: InternalSession | null = null
  private scratches: Scratch[] = []
  private trashed: Scratch[] = []
  private status: SaveStatus = { phase: 'idle' }
  private conflict: ConflictInfo | null = null
  private dirty = false
  private blocksDirty = false
  private canvasDirty = false
  private saveTimer: number | null = null
  private firstDirtyAt: number | null = null
  private flushPromise: Promise<void> | null = null
  private initialized = false
  private initPromise: Promise<void> | null = null
  private externalEpoch = 0
  private lastDatasetRevision = 0
  private lastSnapshotDatasetRevision = 0
  private historyTimer: number | null = null
  private channel: BroadcastChannel | null = null
  private listeners = new Set<(state: ServiceState) => void>()
  private canvasFlushers = new Set<() => Promise<void>>()
  private assetUrls = new Map<string, string>()
  private openToken = 0
  private disposed = false

  constructor(private readonly repo: ScratchRepository) {}

  // ---------- Subscription ----------

  subscribe(listener: (state: ServiceState) => void): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => this.listeners.delete(listener)
  }

  getState(): ServiceState {
    return {
      ready: this.initialized,
      session: this.snapshot(),
      scratches: [...this.scratches],
      trashed: [...this.trashed],
      status: this.status,
      conflict: this.conflict,
      externalEpoch: this.externalEpoch,
    }
  }

  private snapshot(): SessionSnapshot {
    if (!this.session) return { ...EMPTY_SESSION, externalEpoch: this.externalEpoch }
    const blocks = this.session.order
      .map((blockId) => this.session!.blocks.get(blockId))
      .filter((block): block is ContentBlock => Boolean(block))
    return {
      scratch: { ...this.session.scratch },
      blocks,
      order: [...this.session.order],
      canvas: { ...this.session.canvas },
      externalEpoch: this.externalEpoch,
    }
  }

  private emit(): void {
    const state = this.getState()
    for (const listener of this.listeners) {
      try {
        listener(state)
      } catch {
        // A broken subscriber must not stop the save pipeline.
      }
    }
  }

  // ---------- Lifecycle ----------

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInit()
    return this.initPromise
  }

  private async doInit(): Promise<void> {
    if (this.initialized) return
    this.scratches = await this.repo.listScratches()
    this.trashed = await this.repo.listTrashed()
    this.lastDatasetRevision = await this.repo.getDatasetRevision()
    this.lastSnapshotDatasetRevision = this.lastDatasetRevision
    if (this.scratches.length === 0) {
      await this.repo.createScratch()
      this.scratches = await this.repo.listScratches()
    }
    const lastId = this.readLastScratchId()
    const target =
      this.scratches.find((scratch) => scratch.id === lastId) ?? this.scratches[0] ?? null
    if (target) await this.openScratch(target.id)
    this.initialized = true
    this.setupChannel()
    this.startHistoryTimer()
    this.emit()
  }

  dispose(): void {
    this.disposed = true
    this.clearSaveTimer()
    if (this.historyTimer !== null) window.clearInterval(this.historyTimer)
    this.historyTimer = null
    if (this.channel) {
      this.channel.close()
      this.channel = null
    }
    for (const url of this.assetUrls.values()) URL.revokeObjectURL(url)
    this.assetUrls.clear()
    this.listeners.clear()
    this.canvasFlushers.clear()
  }

  private setupChannel(): void {
    if (typeof BroadcastChannel === 'undefined') return
    try {
      this.channel = new BroadcastChannel('scratch-sync')
      this.channel.onmessage = (event: MessageEvent<BroadcastSaved>) => {
        const message = event.data
        if (!message || message.source === this.instanceId) return
        if (message.type === 'saved') void this.handleRemoteSaved(message)
      }
    } catch {
      this.channel = null
    }
  }

  private broadcastSaved(scratchId: string, revision: number): void {
    if (!this.channel) return
    const message: BroadcastSaved = {
      type: 'saved',
      scratchId,
      revision,
      source: this.instanceId,
    }
    try {
      this.channel.postMessage(message)
    } catch {
      // Channel closing during unload: non-fatal.
    }
  }

  private async handleRemoteSaved(message: BroadcastSaved): Promise<void> {
    await this.refreshLists()
    const session = this.session
    if (!session || session.scratch.id !== message.scratchId) return
    if (message.revision <= session.scratch.revision) return
    if (this.dirty || this.flushPromise) {
      this.conflict = {
        localRevision: session.scratch.revision,
        remoteRevision: message.revision,
      }
      this.setStatus({ phase: 'conflict', message: '另一个标签页更新了此草稿' })
      return
    }
    await this.reloadCurrent()
  }

  private startHistoryTimer(): void {
    if (this.historyTimer !== null) window.clearInterval(this.historyTimer)
    this.historyTimer = window.setInterval(() => {
      void this.capturePeriodicHistory()
    }, HISTORY_INTERVAL_MS)
  }

  private async capturePeriodicHistory(): Promise<void> {
    if (!this.session) return
    if (this.lastDatasetRevision === this.lastSnapshotDatasetRevision) return
    try {
      await this.repo.createHistorySnapshot(this.session.scratch.id, 'periodic', this.loadedOf(this.session))
      this.lastSnapshotDatasetRevision = this.lastDatasetRevision
    } catch {
      // History is best-effort; never block editing.
    }
  }

  async createManualHistorySnapshot(): Promise<void> {
    if (!this.session) return
    await this.flush()
    if (!this.session) return
    await this.repo.createHistorySnapshot(this.session.scratch.id, 'manual', this.loadedOf(this.session))
    this.lastSnapshotDatasetRevision = this.lastDatasetRevision
  }

  private loadedOf(session: InternalSession): LoadedSession {
    return {
      scratch: { ...session.scratch },
      blocks: session.order
        .map((id) => session.blocks.get(id))
        .filter((block): block is ContentBlock => Boolean(block)),
      order: [...session.order],
      canvas: { ...session.canvas },
    }
  }

  // ---------- Scratch list ----------

  async refreshLists(): Promise<void> {
    this.scratches = await this.repo.listScratches()
    this.trashed = await this.repo.listTrashed()
    this.emit()
  }

  private upsertScratchInList(scratch: Scratch): void {
    const index = this.scratches.findIndex((item) => item.id === scratch.id)
    if (index >= 0) this.scratches[index] = { ...scratch }
    else this.scratches.unshift({ ...scratch })
    this.scratches.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  // ---------- Scratch lifecycle ----------

  async openScratch(id: ID): Promise<void> {
    if (this.session?.scratch.id === id) return
    if (this.conflict) {
      throw new Error('请先处理当前草稿的跨标签冲突，再切换草稿')
    }
    const token = ++this.openToken
    await this.runCanvasFlushers()
    await this.flush()
    const loaded = await this.repo.loadSession(id)
    if (token !== this.openToken) return
    if (!loaded || loaded.scratch.deletedAt) {
      await this.refreshLists()
      throw new NotFoundError('草稿不存在或已在回收站')
    }
    this.applyLoaded(loaded)
    this.conflict = null
    this.dirty = false
    this.blocksDirty = false
    this.canvasDirty = false
    this.firstDirtyAt = null
    this.clearSaveTimer()
    this.setStatus({ phase: 'saved', at: Date.now() })
    this.writeLastScratchId(id)
  }

  private applyLoaded(loaded: LoadedSession): void {
    this.session = {
      scratch: loaded.scratch,
      blocks: new Map(loaded.blocks.map((block) => [block.id, block])),
      order: [...loaded.order],
      canvas: loaded.canvas,
    }
    this.externalEpoch += 1
    this.emit()
  }

  async reloadCurrent(): Promise<void> {
    if (!this.session) return
    const id = this.session.scratch.id
    const loaded = await this.repo.loadSession(id)
    if (!loaded) return
    this.applyLoaded(loaded)
    this.conflict = null
    this.dirty = false
    this.blocksDirty = false
    this.canvasDirty = false
    this.clearSaveTimer()
    this.setStatus({ phase: 'saved', at: Date.now() })
  }

  async createScratch(title = ''): Promise<Scratch> {
    if (this.conflict) {
      throw new Error('请先处理当前草稿的跨标签冲突，再新建草稿')
    }
    await this.runCanvasFlushers()
    await this.flush()
    const scratch = await this.repo.createScratch(title)
    await this.refreshLists()
    await this.openScratch(scratch.id)
    return scratch
  }

  async renameScratch(id: ID, title: string): Promise<void> {
    const trimmed = title.trim()
    if (this.session && this.session.scratch.id === id) {
      this.session.scratch.title = trimmed
      if (trimmed.length === 0) {
        this.session.scratch.titleIsAuto = true
        const candidate = titleCandidateFromDoc(this.currentDoc(this.session))
        this.session.scratch.title = candidate
      } else {
        this.session.scratch.titleIsAuto = false
      }
      this.upsertScratchInList(this.session.scratch)
      this.scheduleSave({})
      this.emit()
      return
    }
    const scratch = await this.repo.getScratch(id)
    if (!scratch) throw new NotFoundError()
    const next: Scratch = {
      ...scratch,
      title: trimmed,
      titleIsAuto: false,
      updatedAt: Date.now(),
      revision: scratch.revision + 1,
    }
    await this.repo.saveSession({
      scratch: next,
      blocks: [],
      order: [],
      canvas: {
        scratchId: id,
        snapshot: null,
        hiddenBlockIds: [],
        updatedAt: Date.now(),
      },
      blocksDirty: false,
      canvasDirty: false,
      baseRevision: scratch.revision,
    })
    await this.refreshLists()
  }

  async trashScratch(id: ID): Promise<void> {
    if (this.session?.scratch.id === id && this.conflict) {
      throw new Error('请先处理当前草稿的跨标签冲突，再删除草稿')
    }
    if (this.session?.scratch.id === id) {
      await this.runCanvasFlushers()
      await this.flush()
    }
    await this.repo.trashScratch(id)
    await this.refreshLists()
    if (this.session?.scratch.id === id) {
      this.session = null
      this.conflict = null
      this.dirty = false
      this.blocksDirty = false
      this.canvasDirty = false
      this.clearSaveTimer()
      const next = this.scratches[0]
      if (next) {
        await this.openScratch(next.id)
      } else {
        const created = await this.repo.createScratch()
        await this.refreshLists()
        await this.openScratch(created.id)
      }
    }
    this.emit()
  }

  async restoreScratch(id: ID): Promise<void> {
    await this.repo.restoreScratch(id)
    await this.refreshLists()
  }

  async deleteScratchPermanently(id: ID): Promise<void> {
    if (this.session?.scratch.id === id) return
    await this.repo.deleteScratchPermanently(id)
    await this.refreshLists()
  }

  // ---------- Mode ----------

  async setMode(mode: ScratchMode): Promise<void> {
    if (!this.session || this.session.scratch.activeMode === mode) return
    await this.runCanvasFlushers()
    if (!this.session) return
    this.session.scratch.activeMode = mode
    this.upsertScratchInList(this.session.scratch)
    this.scheduleSave({})
    this.emit()
  }

  // ---------- Paper ⇄ Blocks ----------

  /**
   * Reconcile the Tiptap document with the block model: every meaningful
   * top-level node becomes a Block; blocks whose nodes were removed are
   * deleted. Block IDs live in the node's `blockId` attr, so switching modes
   * never re-creates cards.
   */
  async syncPaperDocument(doc: TipTapNode, scratchId?: ID): Promise<void> {
    const session = this.session
    if (!session) return
    if (scratchId && session.scratch.id !== scratchId) return
    const nodes = doc.type === 'doc' ? (doc.content ?? []) : [doc]
    const nowMs = Date.now()
    const nextBlocks: ContentBlock[] = []
    const nextOrder: ID[] = []
    const seen = new Set<ID>()
    let blocksChanged = false

    for (const rawNode of nodes) {
      let node = rawNode
      let blockId = getBlockId(node)
      if (!blockId) {
        if (!isNodeMeaningful(node)) continue
        blockId = newId()
        node = withBlockId(node, blockId)
        blocksChanged = true
      }
      if (seen.has(blockId)) continue
      const existing = session.blocks.get(blockId)
      if (!existing && !isNodeMeaningful(node)) continue
      seen.add(blockId)
      const kind = nodeKind(node)
      const unchanged =
        existing !== undefined &&
        existing.kind === kind &&
        JSON.stringify(existing.content.node) === JSON.stringify(node)
      if (unchanged) {
        nextBlocks.push(existing)
      } else {
        blocksChanged = true
        nextBlocks.push({
          id: blockId,
          scratchId: session.scratch.id,
          kind,
          content: { node },
          createdAt: existing?.createdAt ?? nowMs,
          updatedAt: nowMs,
          revision: (existing?.revision ?? 0) + 1,
        })
      }
      nextOrder.push(blockId)
    }

    for (const blockId of session.blocks.keys()) {
      if (!seen.has(blockId)) blocksChanged = true
    }
    if (!sameOrder(session.order, nextOrder)) blocksChanged = true

    let title: string | null = null
    if (session.scratch.titleIsAuto) {
      const candidate = titleCandidateFromDoc(doc)
      if (candidate !== session.scratch.title) {
        session.scratch.title = candidate
        title = candidate
        this.upsertScratchInList(session.scratch)
      }
    }

    if (!blocksChanged && title === null) return

    if (blocksChanged) {
      session.blocks = new Map(nextBlocks.map((block) => [block.id, block]))
      session.order = nextOrder
      const hidden = session.canvas.hiddenBlockIds.filter((blockId) => seen.has(blockId))
      if (hidden.length !== session.canvas.hiddenBlockIds.length) {
        session.canvas = { ...session.canvas, hiddenBlockIds: hidden }
        this.canvasDirty = true
      }
    }

    this.scheduleSave({ blocks: blocksChanged })
    this.emit()
  }

  /** Update a single block from the canvas card editor. */
  async syncBlockNode(blockId: ID, node: TipTapNode): Promise<void> {
    const session = this.session
    if (!session) return
    const existing = session.blocks.get(blockId)
    const normalized = withBlockId(node, blockId)
    if (existing && JSON.stringify(existing.content.node) === JSON.stringify(normalized)) return
    const nowMs = Date.now()
    const block: ContentBlock = {
      id: blockId,
      scratchId: session.scratch.id,
      kind: nodeKind(normalized),
      content: { node: normalized },
      createdAt: existing?.createdAt ?? nowMs,
      updatedAt: nowMs,
      revision: (existing?.revision ?? 0) + 1,
    }
    session.blocks.set(blockId, block)
    if (!existing) session.order.push(blockId)
    if (session.scratch.titleIsAuto) {
      const candidate = titleCandidateFromDoc(this.currentDoc(session))
      if (candidate !== session.scratch.title) {
        session.scratch.title = candidate
        this.upsertScratchInList(session.scratch)
      }
    }
    this.scheduleSave({ blocks: true })
    this.emit()
  }

  private currentDoc(session: InternalSession): TipTapNode {
    return {
      type: 'doc',
      content: session.order
        .map((blockId) => session.blocks.get(blockId)?.content.node)
        .filter((node): node is TipTapNode => Boolean(node))
        .map((node) => ({ ...node })),
    }
  }

  async addBlockFromCanvas(kind: 'richtext' | 'code' = 'richtext'): Promise<ID> {
    const session = this.session
    if (!session) throw new Error('没有打开的草稿')
    const blockId = newId()
    const node =
      kind === 'code' ? createCodeBlockNode(blockId) : createParagraphNode(blockId)
    const nowMs = Date.now()
    const block: ContentBlock = {
      id: blockId,
      scratchId: session.scratch.id,
      kind: nodeKind(node),
      content: { node },
      createdAt: nowMs,
      updatedAt: nowMs,
      revision: 1,
    }
    session.blocks.set(blockId, block)
    session.order.push(blockId)
    session.canvas.hiddenBlockIds = session.canvas.hiddenBlockIds.filter((id) => id !== blockId)
    this.scheduleSave({ blocks: true })
    this.emit()
    return blockId
  }

  /** Explicit content deletion (from the canvas card menu). */
  async deleteBlock(blockId: ID): Promise<void> {
    const session = this.session
    if (!session) return
    if (!session.blocks.has(blockId)) return
    session.blocks.delete(blockId)
    session.order = session.order.filter((id) => id !== blockId)
    session.canvas.hiddenBlockIds = session.canvas.hiddenBlockIds.filter((id) => id !== blockId)
    this.scheduleSave({ blocks: true })
    this.emit()
  }

  /** Remove a card from the canvas without touching its content. */
  async hideBlock(blockId: ID): Promise<void> {
    const session = this.session
    if (!session || !session.blocks.has(blockId)) return
    if (session.canvas.hiddenBlockIds.includes(blockId)) return
    session.canvas = {
      ...session.canvas,
      hiddenBlockIds: [...session.canvas.hiddenBlockIds, blockId],
      updatedAt: Date.now(),
    }
    this.scheduleSave({ canvas: true })
    this.emit()
  }

  async showAllHiddenBlocks(): Promise<void> {
    const session = this.session
    if (!session || session.canvas.hiddenBlockIds.length === 0) return
    session.canvas = { ...session.canvas, hiddenBlockIds: [], updatedAt: Date.now() }
    this.scheduleSave({ canvas: true })
    this.emit()
  }

  async unhideBlock(blockId: ID): Promise<void> {
    const session = this.session
    if (!session || !session.canvas.hiddenBlockIds.includes(blockId)) return
    session.canvas = {
      ...session.canvas,
      hiddenBlockIds: session.canvas.hiddenBlockIds.filter((id) => id !== blockId),
      updatedAt: Date.now(),
    }
    this.scheduleSave({ canvas: true })
    this.emit()
  }

  /**
   * Replace one block with the top-level nodes produced by the canvas card
   * editor (Enter is normally a hard break there; this covers multi-paragraph
   * pastes). The first node keeps the original Block ID.
   */
  async replaceBlockWithNodes(blockId: ID, nodes: TipTapNode[]): Promise<void> {
    const session = this.session
    if (!session) return
    const existing = session.blocks.get(blockId)
    if (!existing) return
    const normalized = nodes.length > 0 ? nodes : [createParagraphNode(blockId)]
    const nowMs = Date.now()
    const created: ContentBlock[] = []
    normalized.forEach((node, index) => {
      const id = index === 0 ? blockId : newId()
      const normalizedNode = withBlockId(node, id)
      const previous = session.blocks.get(id)
      created.push({
        id,
        scratchId: session.scratch.id,
        kind: nodeKind(normalizedNode),
        content: { node: normalizedNode },
        createdAt: previous?.createdAt ?? nowMs,
        updatedAt: nowMs,
        revision: (previous?.revision ?? 0) + 1,
      })
    })
    for (const block of created) session.blocks.set(block.id, block)
    const index = session.order.indexOf(blockId)
    const remaining = session.order.filter((id) => id !== blockId)
    const insertAt = index >= 0 ? index : remaining.length
    const createdIds = created.map((block) => block.id)
    session.order = [
      ...remaining.slice(0, insertAt),
      ...createdIds,
      ...remaining.slice(insertAt),
    ]
    this.scheduleSave({ blocks: true })
    this.emit()
  }

  async saveCanvas(snapshot: unknown, sessionState?: unknown, scratchId?: ID): Promise<void> {
    const session = this.session
    if (!session) return
    if (scratchId && session.scratch.id !== scratchId) return
    session.canvas = {
      ...session.canvas,
      snapshot,
      sessionState,
      updatedAt: Date.now(),
    }
    this.scheduleSave({ canvas: true })
  }

  registerCanvasFlusher(flusher: () => Promise<void>): () => void {
    this.canvasFlushers.add(flusher)
    return () => this.canvasFlushers.delete(flusher)
  }

  private async runCanvasFlushers(): Promise<void> {
    const flushers = [...this.canvasFlushers]
    await Promise.all(
      flushers.map(async (flusher) => {
        try {
          await flusher()
        } catch {
          // Losing a canvas snapshot must not block switching scratches.
        }
      }),
    )
  }

  // ---------- Save pipeline ----------

  private scheduleSave(flags: { blocks?: boolean; canvas?: boolean }): void {
    if (!this.session) return
    this.dirty = true
    if (flags.blocks) this.blocksDirty = true
    if (flags.canvas) this.canvasDirty = true
    const nowMs = Date.now()
    if (this.firstDirtyAt === null) this.firstDirtyAt = nowMs
    this.clearSaveTimer()
    const elapsed = nowMs - this.firstDirtyAt
    const delay = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, SAVE_MAX_DELAY_MS - elapsed))
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null
      void this.flush()
    }, delay)
    if (this.status.phase !== 'conflict') {
      this.setStatus({ phase: 'saving' })
    } else {
      this.emit()
    }
  }

  private clearSaveTimer(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
  }

  private setStatus(status: SaveStatus): void {
    this.status = status
    this.emit()
  }

  async flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise
    this.flushPromise = this.performFlush()
    try {
      await this.flushPromise
    } finally {
      this.flushPromise = null
    }
  }

  private async performFlush(): Promise<void> {
    let rounds = 0
    while (this.session && this.dirty && !this.conflict && rounds < 20 && !this.disposed) {
      rounds += 1
      const session = this.session
      this.clearSaveTimer()
      const blocksDirty = this.blocksDirty
      const canvasDirty = this.canvasDirty
      this.dirty = false
      this.blocksDirty = false
      this.canvasDirty = false
      this.setStatus({ phase: 'saving' })
      try {
        const result = await this.repo.saveSession({
          scratch: { ...session.scratch },
          blocks: [...session.blocks.values()].map((block) => ({ ...block })),
          order: [...session.order],
          canvas: { ...session.canvas },
          blocksDirty,
          canvasDirty,
          baseRevision: session.scratch.revision,
        })
        session.scratch.revision = result.revision
        session.scratch.updatedAt = result.updatedAt
        this.upsertScratchInList(session.scratch)
        this.lastDatasetRevision = result.datasetRevision
        this.firstDirtyAt = null
        this.broadcastSaved(session.scratch.id, result.revision)
        if (!this.dirty) {
          this.status = { phase: 'saved', at: Date.now() }
          this.emit()
        } else {
          this.status = { phase: 'saving' }
          this.emit()
        }
      } catch (error) {
        this.dirty = true
        this.blocksDirty = this.blocksDirty || blocksDirty
        this.canvasDirty = this.canvasDirty || canvasDirty
        if (error instanceof ConflictError) {
          this.conflict = {
            localRevision: session.scratch.revision,
            remoteRevision: error.remoteRevision,
          }
          this.setStatus({ phase: 'conflict', message: '另一个标签页更新了此草稿' })
        } else {
          this.setStatus({
            phase: 'error',
            message: error instanceof Error ? error.message : '保存失败',
          })
        }
        return
      }
    }
    this.emit()
  }

  async resolveConflict(action: 'reload' | 'overwrite'): Promise<void> {
    if (!this.conflict) return
    if (action === 'reload') {
      await this.reloadCurrent()
      return
    }
    if (!this.session) return
    this.session.scratch.revision = this.conflict.remoteRevision
    this.conflict = null
    this.dirty = true
    this.blocksDirty = true
    this.canvasDirty = true
    this.setStatus({ phase: 'saving' })
    await this.flush()
  }

  // ---------- Assets ----------

  async addAssetFromBlob(blob: Blob): Promise<string> {
    if (!blob.type.startsWith('image/')) throw new Error('只支持图片文件')
    if (blob.size > MAX_IMAGE_BYTES) throw new Error('图片超过 20 MB 限制')
    const asset = await this.repo.addAsset(blob)
    return asset.id
  }

  async getAssetUrl(assetId: string): Promise<string | null> {
    const cached = this.assetUrls.get(assetId)
    if (cached) return cached
    const asset = await this.repo.getAsset(assetId)
    if (!asset) return null
    const url = URL.createObjectURL(asset.blob)
    this.assetUrls.set(assetId, url)
    return url
  }

  async getAssetBlob(assetId: string): Promise<Blob | null> {
    const asset = await this.repo.getAsset(assetId)
    return asset?.blob ?? null
  }

  // ---------- Misc ----------

  async searchScratches(query: string) {
    return this.repo.searchScratches(query)
  }

  async getDatasetRevision(): Promise<number> {
    return this.repo.getDatasetRevision()
  }

  // ---------- Dataset transfer (backups / restore) ----------

  async exportDataset() {
    await this.flush()
    return this.repo.exportDataset()
  }

  async saveSafetyBackup(blob: Blob, reason: string) {
    return this.repo.saveSafetyBackup(blob, reason)
  }

  async listSafetyBackups() {
    return this.repo.listSafetyBackups()
  }

  async createSnapshot(reason: 'manual' | 'pre-restore' | 'pre-import') {
    if (!this.session) return
    await this.flush()
    if (!this.session) return
    await this.repo.createHistorySnapshot(this.session.scratch.id, reason, this.loadedOf(this.session))
  }

  /**
   * Replace the whole local dataset (explicit restore only). Callers must
   * parse/validate the archive and create a safety backup beforehand.
   */
  async replaceDataset(dataset: Dataset): Promise<void> {
    const previousId = this.session?.scratch.id ?? null
    await this.runCanvasFlushers()
    this.clearSaveTimer()
    this.session = null
    this.dirty = false
    this.blocksDirty = false
    this.canvasDirty = false
    this.conflict = null
    this.firstDirtyAt = null
    try {
      await this.repo.replaceDataset(dataset)
    } catch (error) {
      await this.refreshLists()
      const fallback =
        this.scratches.find((scratch) => scratch.id === previousId) ?? this.scratches[0]
      if (fallback) await this.openScratch(fallback.id)
      throw error
    }
    await this.refreshLists()
    const target = this.scratches[0]
    if (target) {
      await this.openScratch(target.id)
    } else {
      const created = await this.repo.createScratch()
      await this.refreshLists()
      await this.openScratch(created.id)
    }
    this.externalEpoch += 1
    this.setStatus({ phase: 'saved', at: Date.now() })
  }

  getCurrentScratchId(): ID | null {
    return this.session?.scratch.id ?? null
  }

  getCurrentLoadedSession(): LoadedSession | null {
    return this.session ? this.loadedOf(this.session) : null
  }

  private readLastScratchId(): string | null {
    try {
      return localStorage.getItem(LAST_SCRATCH_KEY)
    } catch {
      return null
    }
  }

  private writeLastScratchId(id: string): void {
    try {
      localStorage.setItem(LAST_SCRATCH_KEY, id)
    } catch {
      // Private mode: non-fatal.
    }
  }
}

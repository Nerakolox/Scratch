import type {
  CanvasLayoutRecord,
  ContentBlock,
  Dataset,
  ID,
  MediaAsset,
  PaperLayout,
  Scratch,
  ScratchSearchResult,
} from '@/core/models/types'
import {
  collectAssetIds,
  docToPlainText,
  imageAssetId,
  nodeToPlainText,
} from '@/core/content'
import type { AssetRecord, ScratchDB, HistoryRecord, SafetyBackupRecord } from './db'

export class ConflictError extends Error {
  constructor(public readonly remoteRevision: number) {
    super(`Save conflict: remote revision ${remoteRevision}`)
    this.name = 'ConflictError'
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

export interface SaveSessionInput {
  scratch: Scratch
  blocks: ContentBlock[]
  order: ID[]
  canvas: CanvasLayoutRecord
  blocksDirty: boolean
  canvasDirty: boolean
  /** Last revision this client has observed. Omit to force-overwrite. */
  baseRevision?: number
}

export interface SaveSessionResult {
  revision: number
  updatedAt: number
  datasetRevision: number
}

export interface LoadedSession {
  scratch: Scratch
  blocks: ContentBlock[]
  order: ID[]
  canvas: CanvasLayoutRecord
}

const MAX_HISTORY_PER_SCRATCH = 50
const MAX_SAFETY_BACKUPS = 5

async function sha256Hex(bytes: ArrayBuffer): Promise<string | undefined> {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return undefined
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return undefined
  }
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

export class ScratchRepository {
  constructor(private readonly db: ScratchDB) {}

  // ---------- Scratches ----------

  async listScratches(options: { includeDeleted?: boolean } = {}): Promise<Scratch[]> {
    const all = await this.db.scratches.toArray()
    const filtered = options.includeDeleted ? all : all.filter((s) => !s.deletedAt)
    return filtered.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async listTrashed(): Promise<Scratch[]> {
    const all = await this.db.scratches.toArray()
    return all.filter((s) => s.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
  }

  async getScratch(id: ID): Promise<Scratch | undefined> {
    return this.db.scratches.get(id)
  }

  async createScratch(title = ''): Promise<Scratch> {
    const now = Date.now()
    const scratch: Scratch = {
      id: crypto.randomUUID(),
      title,
      titleIsAuto: title.length === 0,
      activeMode: 'paper',
      createdAt: now,
      updatedAt: now,
      revision: 0,
    }
    const paper: PaperLayout = { scratchId: scratch.id, blockOrder: [] }
    const canvas: CanvasLayoutRecord = {
      scratchId: scratch.id,
      snapshot: null,
      hiddenBlockIds: [],
      updatedAt: now,
    }
    await this.db.transaction(
      'rw',
      this.db.scratches,
      this.db.paperLayouts,
      this.db.canvasLayouts,
      this.db.settings,
      async () => {
        await this.db.scratches.put(scratch)
        await this.db.paperLayouts.put(paper)
        await this.db.canvasLayouts.put(canvas)
        await this.bumpDatasetRevisionInTx()
      },
    )
    return scratch
  }

  async loadSession(id: ID): Promise<LoadedSession | null> {
    const scratch = await this.db.scratches.get(id)
    if (!scratch) return null
    const [blocks, paper, canvas] = await Promise.all([
      this.db.blocks.where('scratchId').equals(id).toArray(),
      this.db.paperLayouts.get(id),
      this.db.canvasLayouts.get(id),
    ])
    const byId = new Map(blocks.map((b) => [b.id, b]))
    const order: ID[] = []
    for (const blockId of paper?.blockOrder ?? []) {
      if (byId.has(blockId) && !order.includes(blockId)) order.push(blockId)
    }
    const remaining = blocks
      .filter((b) => !order.includes(b.id))
      .sort((a, b) => a.createdAt - b.createdAt)
    for (const block of remaining) order.push(block.id)
    return {
      scratch,
      blocks: order.map((blockId) => byId.get(blockId)!).filter(Boolean),
      order,
      canvas: canvas ?? {
        scratchId: id,
        snapshot: null,
        hiddenBlockIds: [],
        updatedAt: Date.now(),
      },
    }
  }

  async saveSession(input: SaveSessionInput): Promise<SaveSessionResult> {
    const { scratch, blocks, order, canvas, blocksDirty, canvasDirty, baseRevision } = input
    return this.db.transaction(
      'rw',
      this.db.scratches,
      this.db.blocks,
      this.db.paperLayouts,
      this.db.canvasLayouts,
      this.db.settings,
      async () => {
        const existing = await this.db.scratches.get(scratch.id)
        if (!existing) throw new NotFoundError(`Scratch ${scratch.id} no longer exists`)
        if (baseRevision !== undefined && existing.revision !== baseRevision) {
          throw new ConflictError(existing.revision)
        }
        const now = Date.now()
        const revision = existing.revision + 1
        const nextScratch: Scratch = {
          ...scratch,
          createdAt: existing.createdAt,
          revision,
          updatedAt: now,
        }
        await this.db.scratches.put(nextScratch)
        if (blocksDirty) {
          const existingIds = await this.db.blocks.where('scratchId').equals(scratch.id).primaryKeys()
          const keep = new Set(blocks.map((b) => b.id))
          const stale = existingIds.filter((blockId) => !keep.has(blockId))
          if (stale.length > 0) await this.db.blocks.bulkDelete(stale)
          if (blocks.length > 0) {
            await this.db.blocks.bulkPut(
              blocks.map((block) => ({ ...block, scratchId: scratch.id, revision, updatedAt: now })),
            )
          }
          await this.db.paperLayouts.put({ scratchId: scratch.id, blockOrder: order })
        }
        if (canvasDirty) {
          await this.db.canvasLayouts.put({ ...canvas, scratchId: scratch.id, updatedAt: now })
        }
        const datasetRevision = await this.bumpDatasetRevisionInTx()
        return { revision, updatedAt: now, datasetRevision }
      },
    )
  }

  async trashScratch(id: ID): Promise<void> {
    await this.db.transaction('rw', this.db.scratches, this.db.settings, async () => {
      const scratch = await this.db.scratches.get(id)
      if (!scratch) throw new NotFoundError()
      await this.db.scratches.put({
        ...scratch,
        deletedAt: Date.now(),
        updatedAt: Date.now(),
        revision: scratch.revision + 1,
      })
      await this.bumpDatasetRevisionInTx()
    })
  }

  async restoreScratch(id: ID): Promise<Scratch> {
    return this.db.transaction('rw', this.db.scratches, this.db.settings, async () => {
      const scratch = await this.db.scratches.get(id)
      if (!scratch) throw new NotFoundError()
      const next: Scratch = {
        ...scratch,
        deletedAt: undefined,
        updatedAt: Date.now(),
        revision: scratch.revision + 1,
      }
      await this.db.scratches.put(next)
      await this.bumpDatasetRevisionInTx()
      return next
    })
  }

  async deleteScratchPermanently(id: ID): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.scratches,
        this.db.blocks,
        this.db.paperLayouts,
        this.db.canvasLayouts,
        this.db.assets,
        this.db.history,
        this.db.settings,
      ],
      async () => {
        await this.db.scratches.delete(id)
        await this.db.blocks.where('scratchId').equals(id).delete()
        await this.db.paperLayouts.delete(id)
        await this.db.canvasLayouts.delete(id)
        await this.db.history.where('scratchId').equals(id).delete()
        await this.gcAssetsInTx()
        await this.bumpDatasetRevisionInTx()
      },
    )
  }

  private async gcAssetsInTx(): Promise<void> {
    const blocks = await this.db.blocks.toArray()
    const referenced = new Set<string>()
    for (const block of blocks) collectAssetIds(block.content.node, referenced)
    const allAssetIds = await this.db.assets.toCollection().primaryKeys()
    const unused = allAssetIds.filter((assetId) => !referenced.has(assetId))
    if (unused.length > 0) await this.db.assets.bulkDelete(unused)
  }

  // ---------- Search ----------

  async searchScratches(query: string): Promise<ScratchSearchResult[]> {
    const q = query.trim().toLocaleLowerCase()
    if (!q) return []
    const [scratches, blocks] = await Promise.all([
      this.listScratches(),
      this.db.blocks.toArray(),
    ])
    const blocksByScratch = new Map<string, ContentBlock[]>()
    for (const block of blocks) {
      const list = blocksByScratch.get(block.scratchId) ?? []
      list.push(block)
      blocksByScratch.set(block.scratchId, list)
    }
    const results: ScratchSearchResult[] = []
    for (const scratch of scratches) {
      const titleMatch = scratch.title.toLocaleLowerCase().includes(q)
      let snippet = ''
      let hits = 0
      for (const block of blocksByScratch.get(scratch.id) ?? []) {
        const text = nodeToPlainText(block.content.node)
        const lower = text.toLocaleLowerCase()
        const index = lower.indexOf(q)
        if (index >= 0) {
          hits += 1
          if (!snippet) {
            const start = Math.max(0, index - 30)
            const end = Math.min(text.length, index + q.length + 40)
            snippet = `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
          }
        }
      }
      if (!titleMatch && hits === 0) continue
      if (!snippet) {
        const first = (blocksByScratch.get(scratch.id) ?? [])
          .map((b) => docToPlainText(b.content.node))
          .find((t) => t.trim().length > 0)
        snippet = (first ?? '').slice(0, 80)
      }
      results.push({ scratch, snippet, score: (titleMatch ? 1000 : 0) + hits * 10 })
    }
    return results.sort((a, b) => b.score - a.score || b.scratch.updatedAt - a.scratch.updatedAt)
  }

  // ---------- Assets ----------

  async addAsset(blob: Blob, mimeType = blob.type || 'application/octet-stream'): Promise<MediaAsset> {
    const bytes = await blobToBytes(blob)
    const sha256 = await sha256Hex(bytes.buffer as ArrayBuffer)
    if (sha256) {
      const existing = await this.db.assets.where('sha256').equals(sha256).first()
      if (existing) return this.assetFromRecord(existing)
    }
    const record: AssetRecord = {
      id: crypto.randomUUID(),
      mimeType,
      size: blob.size,
      sha256,
      createdAt: Date.now(),
      bytes,
    }
    await this.db.assets.put(record)
    return this.assetFromRecord(record)
  }

  private assetFromRecord(record: AssetRecord): MediaAsset {
    return {
      id: record.id,
      mimeType: record.mimeType,
      size: record.size,
      sha256: record.sha256,
      createdAt: record.createdAt,
      blob: new Blob([record.bytes as BlobPart], { type: record.mimeType }),
    }
  }

  async getAsset(id: ID): Promise<MediaAsset | undefined> {
    const record = await this.db.assets.get(id)
    return record ? this.assetFromRecord(record) : undefined
  }

  // ---------- Dataset ----------

  async exportDataset(): Promise<Dataset> {
    return this.db.transaction(
      'r',
      this.db.scratches,
      this.db.blocks,
      this.db.paperLayouts,
      this.db.canvasLayouts,
      this.db.assets,
      async () => {
        const [scratches, blocks, paperLayouts, canvasLayouts, assets] = await Promise.all([
          this.db.scratches.toArray(),
          this.db.blocks.toArray(),
          this.db.paperLayouts.toArray(),
          this.db.canvasLayouts.toArray(),
          this.db.assets.toArray(),
        ])
        const assetsWithBytes = assets.map((asset) => ({
          id: asset.id,
          mimeType: asset.mimeType,
          size: asset.size,
          sha256: asset.sha256,
          createdAt: asset.createdAt,
          blob: new Blob([asset.bytes as BlobPart], { type: asset.mimeType }),
          bytes: asset.bytes,
        }))
        return { scratches, blocks, paperLayouts, canvasLayouts, assets: assetsWithBytes }
      },
    )
  }

  async replaceDataset(dataset: Dataset): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.scratches,
        this.db.blocks,
        this.db.paperLayouts,
        this.db.canvasLayouts,
        this.db.assets,
        this.db.settings,
      ],
      async () => {
        await Promise.all([
          this.db.scratches.clear(),
          this.db.blocks.clear(),
          this.db.paperLayouts.clear(),
          this.db.canvasLayouts.clear(),
          this.db.assets.clear(),
        ])
        await this.db.scratches.bulkPut(dataset.scratches)
        await this.db.blocks.bulkPut(dataset.blocks)
        await this.db.paperLayouts.bulkPut(dataset.paperLayouts)
        await this.db.canvasLayouts.bulkPut(dataset.canvasLayouts)
        await this.db.assets.bulkPut(
          dataset.assets.map((asset) => ({
            id: asset.id,
            mimeType: asset.mimeType,
            size: asset.size,
            sha256: asset.sha256,
            createdAt: asset.createdAt,
            bytes: asset.bytes,
          })),
        )
        await this.bumpDatasetRevisionInTx()
      },
    )
  }

  // ---------- Settings ----------

  async getSetting<T>(key: string): Promise<T | undefined> {
    const record = await this.db.settings.get(key)
    return record ? (record.value as T) : undefined
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db.settings.put({ key, value })
  }

  async deleteSetting(key: string): Promise<void> {
    await this.db.settings.delete(key)
  }

  async bumpDatasetRevision(): Promise<number> {
    return this.db.transaction('rw', this.db.settings, () => this.bumpDatasetRevisionInTx())
  }

  private async bumpDatasetRevisionInTx(): Promise<number> {
    const record = await this.db.settings.get('datasetRevision')
    const next = Number(record?.value ?? 0) + 1
    await this.db.settings.put({ key: 'datasetRevision', value: next })
    return next
  }

  async getDatasetRevision(): Promise<number> {
    return Number((await this.getSetting<number>('datasetRevision')) ?? 0)
  }

  // ---------- History ----------

  async createHistorySnapshot(
    scratchId: ID,
    reason: HistoryRecord['reason'],
    payload?: LoadedSession,
  ): Promise<void> {
    const session = payload ?? (await this.loadSession(scratchId))
    if (!session) return
    const serialized = JSON.stringify(session)
    const record: HistoryRecord = {
      scratchId,
      createdAt: Date.now(),
      reason,
      payload: serialized,
      size: serialized.length,
    }
    await this.db.transaction('rw', this.db.history, async () => {
      await this.db.history.add(record)
      const ids = await this.db.history
        .where('scratchId')
        .equals(scratchId)
        .sortBy('createdAt')
      if (ids.length > MAX_HISTORY_PER_SCRATCH) {
        const excess = ids.slice(0, ids.length - MAX_HISTORY_PER_SCRATCH)
        await this.db.history.bulkDelete(excess.map((entry) => entry.id!).filter(Boolean))
      }
    })
  }

  async listHistory(scratchId: ID): Promise<HistoryRecord[]> {
    const records = await this.db.history.where('scratchId').equals(scratchId).sortBy('createdAt')
    return records.reverse()
  }

  async loadHistoryPayload(id: number): Promise<LoadedSession | null> {
    const record = await this.db.history.get(id)
    if (!record) return null
    try {
      return JSON.parse(record.payload) as LoadedSession
    } catch {
      return null
    }
  }

  // ---------- Safety backups ----------

  async saveSafetyBackup(blob: Blob, reason: string): Promise<SafetyBackupRecord> {
    const record = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      reason,
      size: blob.size,
      blob,
    }
    await this.db.transaction('rw', this.db.safetyBackups, async () => {
      await this.db.safetyBackups.put(record)
      const all = await this.db.safetyBackups.orderBy('createdAt').toArray()
      if (all.length > MAX_SAFETY_BACKUPS) {
        await this.db.safetyBackups.bulkDelete(
          all.slice(0, all.length - MAX_SAFETY_BACKUPS).map((r) => r.id),
        )
      }
    })
    return record
  }

  async listSafetyBackups(): Promise<SafetyBackupRecord[]> {
    const all = await this.db.safetyBackups.orderBy('createdAt').toArray()
    return all.reverse()
  }

  async latestSafetyBackup(): Promise<SafetyBackupRecord | undefined> {
    const all = await this.listSafetyBackups()
    return all[0]
  }

  // ---------- Backup job log ----------

  async logBackupJob(job: Omit<import('./db').BackupJobRecord, 'id'> & { id?: string }) {
    const record = { ...job, id: job.id ?? crypto.randomUUID() }
    await this.db.backupJobs.put(record)
    const all = await this.db.backupJobs.orderBy('createdAt').toArray()
    if (all.length > 100) {
      await this.db.backupJobs.bulkDelete(all.slice(0, all.length - 100).map((r) => r.id))
    }
    return record
  }

  async listBackupJobs(limit = 20) {
    const all = await this.db.backupJobs.orderBy('createdAt').reverse().limit(limit).toArray()
    return all
  }

  // ---------- Utility ----------

  static imageAssetIdsOf(blocks: ContentBlock[]): string[] {
    const ids = new Set<string>()
    for (const block of blocks) {
      const assetId = imageAssetId(block.content.node)
      if (assetId) ids.add(assetId)
    }
    return [...ids]
  }
}

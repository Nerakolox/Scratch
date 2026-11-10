import Dexie, { type Table } from 'dexie'
import type {
  CanvasLayoutRecord,
  ContentBlock,
  PaperLayout,
  Scratch,
} from '@/core/models/types'

export interface SettingRecord {
  key: string
  value: unknown
}

export interface HistoryRecord {
  id?: number
  scratchId: string
  createdAt: number
  reason: 'periodic' | 'manual' | 'pre-restore' | 'pre-import'
  payload: string
  size: number
}

export interface AssetRecord {
  id: string
  mimeType: string
  size: number
  sha256?: string
  createdAt: number
  /** Stored as bytes rather than Blob for reliable structured cloning. */
  bytes: Uint8Array
}

export interface SafetyBackupRecord {
  id: string
  createdAt: number
  reason: string
  size: number
  blob: Blob
}

export interface BackupJobRecord {
  id: string
  providerId: string
  status: 'running' | 'success' | 'error'
  createdAt: number
  finishedAt?: number
  archiveId?: string
  archiveSize?: number
  error?: string
}

export class ScratchDB extends Dexie {
  scratches!: Table<Scratch, string>
  blocks!: Table<ContentBlock, string>
  paperLayouts!: Table<PaperLayout, string>
  canvasLayouts!: Table<CanvasLayoutRecord, string>
  assets!: Table<AssetRecord, string>
  history!: Table<HistoryRecord, number>
  safetyBackups!: Table<SafetyBackupRecord, string>
  backupJobs!: Table<BackupJobRecord, string>
  settings!: Table<SettingRecord, string>

  constructor(name = 'scratch-db') {
    super(name)
    this.version(1).stores({
      scratches: 'id, updatedAt, deletedAt, title',
      blocks: 'id, scratchId, updatedAt',
      paperLayouts: 'scratchId',
      canvasLayouts: 'scratchId',
      assets: 'id, sha256, createdAt',
      history: '++id, scratchId, createdAt',
      safetyBackups: 'id, createdAt',
      backupJobs: 'id, providerId, createdAt, status',
      settings: 'key',
    })
  }
}

let singleton: ScratchDB | null = null

export function getDb(): ScratchDB {
  if (!singleton) singleton = new ScratchDB()
  return singleton
}

export function resetDbSingletonForTests(): void {
  singleton = null
}

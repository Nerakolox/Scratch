import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackupService } from '@/features/backup/backup-service'
import { BackupError } from '@/features/backup/errors'
import { parseBackupArchive } from '@/features/backup/archive/format'
import type {
  BackupProvider,
  RemoteBackupInfo,
  UploadProgress,
} from '@/features/backup/providers/types'
import { ScratchDB } from '@/storage/db'
import { ScratchRepository } from '@/storage/repository'
import { DocumentService } from '@/storage/document-service'
import { nodeToPlainText } from '@/core/content'
import type { TipTapNode } from '@/core/models/types'

function paragraph(text: string, blockId: string): TipTapNode {
  return {
    type: 'paragraph',
    attrs: { blockId },
    content: [{ type: 'text', text }],
  }
}

function doc(...nodes: TipTapNode[]): TipTapNode {
  return { type: 'doc', content: nodes }
}

class FakeProvider implements BackupProvider {
  readonly id = 's3' as const
  readonly label = 'Fake S3'
  readonly description = 'in-memory provider for tests'
  files = new Map<string, { blob: Blob; modifiedAt: number }>()
  connected = true
  private clock = 1

  isConfigured(): boolean {
    return true
  }
  async isConnected(): Promise<boolean> {
    return this.connected
  }
  async connect(): Promise<void> {
    this.connected = true
  }
  async disconnect(): Promise<void> {
    this.connected = false
  }
  async listBackups(): Promise<RemoteBackupInfo[]> {
    return [...this.files.entries()]
      .map(([name, value]) => ({
        id: name,
        name,
        size: value.blob.size,
        modifiedAt: value.modifiedAt,
      }))
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
  }
  async uploadBackup(
    name: string,
    data: Blob,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<RemoteBackupInfo> {
    const modifiedAt = Date.now() + this.clock++
    this.files.set(name, { blob: data, modifiedAt })
    onProgress?.({ loaded: data.size, total: data.size })
    return { id: name, name, size: data.size, modifiedAt }
  }
  async downloadBackup(id: string): Promise<Blob> {
    const file = this.files.get(id)
    if (!file) throw new BackupError('not-found', 'missing')
    return file.blob
  }
  async deleteBackup(id: string): Promise<void> {
    this.files.delete(id)
  }

  newest(): { name: string; blob: Blob; modifiedAt: number } | null {
    const entries = [...this.files.entries()].sort(
      (a, b) => b[1].modifiedAt - a[1].modifiedAt,
    )
    if (entries.length === 0) return null
    return { name: entries[0][0], ...entries[0][1] }
  }
}

let db: ScratchDB
let repo: ScratchRepository
let docs: DocumentService
let fake: FakeProvider
let backup: BackupService

beforeEach(async () => {
  db = new ScratchDB(`scratch-backup-test-${crypto.randomUUID()}`)
  await db.open()
  repo = new ScratchRepository(db)
  docs = new DocumentService(repo)
  await docs.init()
  fake = new FakeProvider()
  backup = new BackupService(repo, docs, { s3: fake })
  await backup.init()
  await backup.updateSettings({
    providerId: 's3',
    autoBackup: false,
    keepCount: 2,
    encryptionEnabled: false,
  })
  const scratchId = docs.getState().session.scratch!.id
  await docs.syncPaperDocument(doc(paragraph('备份内容', 'b1')), scratchId)
  await docs.flush()
})

afterEach(async () => {
  backup.dispose()
  docs.dispose()
  await db.delete()
})

describe('BackupService', () => {
  it('uploads a verified snapshot and records it as the last backup', async () => {
    await backup.runBackup()
    expect(fake.files.size).toBe(1)
    const newest = fake.newest()!
    const state = backup.getState()
    expect(state.lastBackup?.name).toBe(newest.name)
    expect(state.lastBackup?.provider).toBe('s3')
    expect(state.remoteHistory.map((item) => item.name)).toContain(newest.name)

    const parsed = await parseBackupArchive(newest.blob)
    expect(parsed.dataset.blocks).toHaveLength(1)
    expect(nodeToPlainText(parsed.dataset.blocks[0].content.node)).toBe('备份内容')
  })

  it('keeps only the newest N remote snapshots', async () => {
    await backup.runBackup()
    await backup.runBackup()
    await backup.runBackup()
    expect(fake.files.size).toBe(2)

    const remaining = await fake.listBackups()
    expect(remaining).toHaveLength(2)
    expect(remaining[0].modifiedAt).toBeGreaterThanOrEqual(remaining[1].modifiedAt)
  })

  it('requires an encryption password and uploads decryptable archives', async () => {
    await backup.updateSettings({ encryptionEnabled: true })
    await expect(backup.runBackup()).rejects.toMatchObject({ code: 'password-required' })

    backup.setSessionPassword('correct horse battery')
    await backup.runBackup()
    const newest = fake.newest()!
    await expect(parseBackupArchive(newest.blob)).rejects.toMatchObject({
      code: 'password-required',
    })
    const parsed = await parseBackupArchive(newest.blob, {
      password: 'correct horse battery',
    })
    expect(parsed.encrypted).toBe(true)
    expect(parsed.dataset.blocks).toHaveLength(1)
  })

  it('restores an archive only after saving a local safety backup', async () => {
    await backup.runBackup()
    const newest = fake.newest()!
    const parsed = await parseBackupArchive(newest.blob)

    const scratchId = docs.getState().session.scratch!.id
    await docs.syncPaperDocument(doc(paragraph('后来改掉的内容', 'b1')), scratchId)
    await docs.flush()

    await backup.applyRestore(parsed.dataset, { source: 'test-archive' })
    const restored = docs.getState().session.blocks
    expect(nodeToPlainText(restored[0].content.node)).toBe('备份内容')
    const safety = await backup.listSafetyBackups()
    expect(safety).toHaveLength(1)
    expect(safety[0].reason).toContain('test-archive')
  })


  it('auto-backup uploads only when enabled, due, and content changed', async () => {
    await backup.updateSettings({ autoBackup: true, intervalMinutes: 5 })

    // First check: there is no previous backup, so content is backed up.
    await backup.checkAutoBackupNow()
    expect(fake.files.size).toBe(1)
    const firstRevision = backup.getState().lastBackup!.datasetRevision

    // Make the backup old enough, without changing content: the revision gate
    // must prevent a redundant upload.
    const last = backup.getState().lastBackup!
    await repo.setSetting('backup.last', { ...last, at: Date.now() - 10 * 60_000 })
    backup.dispose()
    backup = new BackupService(repo, docs, { s3: fake })
    await backup.init()
    await backup.checkAutoBackupNow()
    expect(fake.files.size).toBe(1)
    expect(backup.getState().lastBackup!.datasetRevision).toBe(firstRevision)

    // A real content change with the interval elapsed uploads again.
    const scratchId = docs.getState().session.scratch!.id
    await docs.syncPaperDocument(doc(paragraph('新的自动备份内容', 'b1')), scratchId)
    await docs.flush()
    await backup.checkAutoBackupNow()
    expect(fake.files.size).toBe(2)

    // Changing content again immediately is not enough: the interval gate
    // must prevent uploading before the next due time.
    await docs.syncPaperDocument(doc(paragraph('间隔内的第二次修改', 'b1')), scratchId)
    await docs.flush()
    await backup.checkAutoBackupNow()
    expect(fake.files.size).toBe(2)
  })

  it('refuses to back up without an active provider', async () => {
    await backup.updateSettings({ providerId: null })
    await expect(backup.runBackup()).rejects.toMatchObject({ code: 'not-configured' })
    expect(fake.files.size).toBe(0)
  })
})

import type { Dataset } from '@/core/models/types'
import type { ScratchRepository } from '@/storage/repository'
import type { DocumentService } from '@/storage/document-service'
import { newId } from '@/core/utils'
import {
  buildBackupArchive,
  parseBackupArchive,
  type BackupManifest,
  type ParseBackupResult,
} from './archive/format'
import { BackupError, errorMessage } from './errors'
import { OneDriveProvider, isBackupFileName } from './providers/onedrive'
import { GoogleDriveProvider } from './providers/google-drive'
import { WebDavProvider } from './providers/webdav'
import { S3Provider } from './providers/s3'
import type {
  BackupProvider,
  ProviderDescriptor,
  ProviderId,
  ProviderSettingsStore,
  RemoteBackupInfo,
} from './providers/types'

export interface BackupSettings {
  providerId: ProviderId | null
  autoBackup: boolean
  intervalMinutes: number
  keepCount: number
  encryptionEnabled: boolean
}

export interface LastBackupInfo {
  at: number
  size: number
  name: string
  provider: ProviderId
  datasetRevision: number
}

export interface BackupState {
  ready: boolean
  settings: BackupSettings
  providers: Record<ProviderId, ProviderDescriptor>
  lastBackup: LastBackupInfo | null
  remoteHistory: RemoteBackupInfo[]
  running: boolean
  progress: number | null
  message: string | null
  error: string | null
  hasSessionPassword: boolean
}

const SETTINGS_KEY = 'backup.settings'
const LAST_KEY = 'backup.last'
const DATASET_ID_KEY = 'backup.datasetId'
const TICK_MS = 60_000

const DEFAULT_SETTINGS: BackupSettings = {
  providerId: null,
  autoBackup: false,
  intervalMinutes: 30,
  keepCount: 10,
  encryptionEnabled: false,
}

const EMPTY_DESCRIPTOR = (id: ProviderId, label: string): ProviderDescriptor => ({
  id,
  label,
  description: '',
  configured: false,
  connected: false,
})

const PROVIDER_ORDER: ProviderId[] = ['onedrive', 'google-drive', 'webdav', 's3']

export class BackupService {
  private settings: BackupSettings = { ...DEFAULT_SETTINGS }
  private lastBackup: LastBackupInfo | null = null
  private remoteHistory: RemoteBackupInfo[] = []
  private providers: Record<ProviderId, BackupProvider>
  private descriptors: Record<ProviderId, ProviderDescriptor> = {
    onedrive: EMPTY_DESCRIPTOR('onedrive', 'OneDrive'),
    'google-drive': EMPTY_DESCRIPTOR('google-drive', 'Google Drive'),
    webdav: EMPTY_DESCRIPTOR('webdav', 'WebDAV'),
    s3: EMPTY_DESCRIPTOR('s3', 'S3 兼容存储'),
  }
  private listeners = new Set<(state: BackupState) => void>()
  private ready = false
  private running = false
  private progress: number | null = null
  private message: string | null = null
  private error: string | null = null
  private sessionPassword: string | null = null
  private ticker: number | null = null
  private autoRunning = false
  private autoFailures = 0
  private nextAutoAttemptAt = 0
  private disposed = false

  constructor(
    private readonly repo: ScratchRepository,
    private readonly docs: DocumentService,
    providerOverrides: Partial<Record<ProviderId, BackupProvider>> = {},
  ) {
    const store: ProviderSettingsStore = {
      get: <T>(key: string) => this.repo.getSetting<T>(key),
      set: (key, value) => this.repo.setSetting(key, value),
      delete: (key) => this.repo.deleteSetting(key),
    }
    this.providers = {
      onedrive: providerOverrides.onedrive ?? new OneDriveProvider(store),
      'google-drive': providerOverrides['google-drive'] ?? new GoogleDriveProvider(store),
      webdav: providerOverrides.webdav ?? new WebDavProvider(store),
      s3: providerOverrides.s3 ?? new S3Provider(store),
    }
  }

  // ---------- Lifecycle ----------

  async init(): Promise<void> {
    if (this.ready) return
    const stored = await this.repo.getSetting<Partial<BackupSettings>>(SETTINGS_KEY)
    this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) }
    this.lastBackup = (await this.repo.getSetting<LastBackupInfo>(LAST_KEY)) ?? null
    this.ready = true
    await this.refreshProviderDescriptors()
    this.emit()
    this.startScheduler()
    if (this.settings.providerId) void this.refreshHistory().catch(() => undefined)
  }

  dispose(): void {
    this.disposed = true
    if (this.ticker !== null) window.clearInterval(this.ticker)
    this.ticker = null
    this.listeners.clear()
  }

  subscribe(listener: (state: BackupState) => void): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => this.listeners.delete(listener)
  }

  getState(): BackupState {
    return {
      ready: this.ready,
      settings: { ...this.settings },
      providers: this.descriptors,
      lastBackup: this.lastBackup,
      remoteHistory: [...this.remoteHistory],
      running: this.running,
      progress: this.progress,
      message: this.message,
      error: this.error,
      hasSessionPassword: this.sessionPassword !== null,
    }
  }

  private emit(): void {
    const state = this.getState()
    for (const listener of this.listeners) {
      try {
        listener(state)
      } catch {
        // A broken subscriber must not stop backups.
      }
    }
  }

  getProvider(id: ProviderId): BackupProvider {
    return this.providers[id]
  }

  async refreshProviders(): Promise<void> {
    await this.refreshProviderDescriptors()
    this.emit()
  }

  private async refreshProviderDescriptors(): Promise<void> {
    const next = {} as Record<ProviderId, ProviderDescriptor>
    for (const id of PROVIDER_ORDER) {
      const provider = this.providers[id]
      let connected: boolean
      try {
        connected = await provider.isConnected()
      } catch {
        connected = false
      }
      next[id] = {
        id,
        label: provider.label,
        description: provider.description,
        configured: provider.isConfigured(),
        connected,
      }
    }
    this.descriptors = next
  }

  // ---------- Settings ----------

  async updateSettings(patch: Partial<BackupSettings>): Promise<void> {
    const previousProvider = this.settings.providerId
    const next: BackupSettings = {
      ...this.settings,
      ...patch,
    }
    next.intervalMinutes = Math.min(24 * 60, Math.max(5, Math.round(next.intervalMinutes)))
    next.keepCount = Math.min(50, Math.max(1, Math.round(next.keepCount)))
    this.settings = next
    await this.repo.setSetting(SETTINGS_KEY, next)
    if (patch.providerId !== undefined && patch.providerId !== previousProvider) {
      this.remoteHistory = []
    }
    this.emit()
  }

  async setActiveProvider(providerId: ProviderId | null): Promise<void> {
    await this.updateSettings({ providerId })
    if (providerId) void this.refreshHistory().catch(() => undefined)
    else {
      this.remoteHistory = []
      this.emit()
    }
  }

  async connectProvider(providerId: ProviderId): Promise<void> {
    this.error = null
    this.emit()
    try {
      await this.providers[providerId].connect()
      await this.refreshProviderDescriptors()
      if (!this.settings.providerId) await this.updateSettings({ providerId })
      await this.refreshHistory()
      this.message = `${this.providers[providerId].label} 已连接`
      this.emit()
    } catch (error) {
      this.error = errorMessage(error)
      this.emit()
      throw error
    }
  }

  async disconnectProvider(providerId: ProviderId): Promise<void> {
    await this.providers[providerId].disconnect()
    await this.refreshProviderDescriptors()
    if (this.settings.providerId === providerId) this.remoteHistory = []
    this.emit()
  }

  setSessionPassword(password: string | null): void {
    this.sessionPassword = password && password.length > 0 ? password : null
    this.emit()
  }

  // ---------- Archive creation / local export ----------

  private async ensureDatasetId(): Promise<string> {
    let id = await this.repo.getSetting<string>(DATASET_ID_KEY)
    if (!id) {
      id = newId()
      await this.repo.setSetting(DATASET_ID_KEY, id)
    }
    return id
  }

  async createArchive(options: { password?: string } = {}): Promise<{
    blob: Blob
    filename: string
    encrypted: boolean
    manifest: BackupManifest
  }> {
    const dataset = await this.docs.exportDataset()
    const datasetId = await this.ensureDatasetId()
    const archive = await buildBackupArchive(dataset, {
      datasetId,
      password: options.password,
    })
    return {
      blob: archive.blob,
      filename: archive.filename,
      encrypted: archive.encrypted,
      manifest: archive.manifest,
    }
  }

  async inspectArchive(blob: Blob, password?: string): Promise<ParseBackupResult> {
    return parseBackupArchive(blob, { password })
  }

  // ---------- Cloud backup ----------

  private requireActiveProvider(): BackupProvider {
    const providerId = this.settings.providerId
    if (!providerId) {
      throw new BackupError('not-configured', '请先选择并连接一个备份服务')
    }
    return this.providers[providerId]
  }

  private async providerPassword(): Promise<string | undefined> {
    if (!this.settings.encryptionEnabled) return undefined
    return this.sessionPassword ?? undefined
  }

  async refreshHistory(): Promise<RemoteBackupInfo[]> {
    const providerId = this.settings.providerId
    if (!providerId) {
      this.remoteHistory = []
      this.emit()
      return []
    }
    try {
      this.remoteHistory = await this.providers[providerId].listBackups()
      this.error = null
    } catch (error) {
      this.error = errorMessage(error)
      this.remoteHistory = []
    }
    this.emit()
    return this.remoteHistory
  }

  async runBackup(options: { password?: string; manual?: boolean } = {}): Promise<void> {
    if (this.running) {
      throw new BackupError('unknown', '已有备份正在进行')
    }
    const provider = this.requireActiveProvider()
    const providerId = this.settings.providerId!
    if (!(await provider.isConnected())) {
      throw new BackupError('auth', '备份服务尚未连接，请先连接')
    }
    const password = options.password ?? (await this.providerPassword())
    if (this.settings.encryptionEnabled && !password) {
      throw new BackupError('password-required', '加密备份需要密码，请输入备份密码')
    }
    if (password) this.sessionPassword = password

    this.running = true
    this.progress = 0
    this.error = null
    this.message = '正在生成备份…'
    this.emit()

    const revisionBefore = await this.docs.getDatasetRevision()
    let job: Awaited<ReturnType<ScratchRepository['logBackupJob']>> | null
    try {
      job = await this.repo.logBackupJob({
        providerId,
        status: 'running',
        createdAt: Date.now(),
      })
    } catch {
      job = null
    }

    try {
      const dataset = await this.docs.exportDataset()
      const datasetId = await this.ensureDatasetId()
      const archive = await buildBackupArchive(dataset, { datasetId, password })

      this.message = '正在上传备份…'
      this.progress = 0.05
      this.emit()

      const uploaded = await provider.uploadBackup(archive.filename, archive.blob, (progress) => {
        this.progress = 0.05 + 0.8 * (progress.loaded / Math.max(1, progress.total))
        this.emit()
      })

      // Verify the archive exists remotely before recording success. Some
      // providers are eventually consistent, so allow a few short retries.
      let remote = null as Awaited<ReturnType<typeof provider.listBackups>>[number] | null
      for (let attempt = 0; attempt < 3 && !remote; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, attempt * 800))
        }
        const listed = await provider.listBackups()
        remote =
          listed.find(
            (item) => item.id === uploaded.id || item.name === archive.filename,
          ) ?? null
      }
      if (!remote) {
        throw new BackupError('network', '上传后在云端未找到该备份，未记录为成功')
      }
      if (remote.size > 0 && remote.size !== archive.blob.size) {
        throw new BackupError('invalid-data', '云端备份大小与本地不一致，未记录为成功')
      }

      const last: LastBackupInfo = {
        at: Date.now(),
        size: archive.blob.size,
        name: archive.filename,
        provider: providerId,
        datasetRevision: revisionBefore,
      }
      this.lastBackup = last
      await this.repo.setSetting(LAST_KEY, last)

      this.message = '正在清理旧备份…'
      this.progress = 0.95
      this.emit()
      const cleanupWarning = await this.pruneRemoteBackups(archive.filename)

      this.remoteHistory = await provider.listBackups()
      this.progress = 1
      this.message = cleanupWarning ? `备份完成（${cleanupWarning}）` : '备份完成'
      this.error = null
      if (job) {
        await this.repo
          .logBackupJob({
            ...job,
            status: 'success',
            finishedAt: Date.now(),
            archiveId: uploaded.id,
            archiveSize: archive.blob.size,
          })
          .catch(() => undefined)
      }
    } catch (error) {
      this.error = errorMessage(error)
      this.message = null
      const failedJob = {
        providerId,
        status: 'error' as const,
        createdAt: job?.createdAt ?? Date.now(),
        finishedAt: Date.now(),
        error: this.error,
      }
      await this.repo.logBackupJob(failedJob).catch(() => undefined)
      throw error
    } finally {
      this.running = false
      this.progress = null
      this.emit()
    }
  }

  private async pruneRemoteBackups(keepName: string): Promise<string | null> {
    const provider = this.requireActiveProvider()
    const keep = Math.max(1, this.settings.keepCount)
    const all = (await provider.listBackups())
      .filter((item) => isBackupFileName(item.name))
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
    const excess = all.slice(keep).filter((item) => item.name !== keepName)
    let failures = 0
    for (const item of excess) {
      try {
        await provider.deleteBackup(item.id)
      } catch {
        failures += 1
      }
    }
    return failures > 0 ? `${failures} 个旧备份清理失败` : null
  }

  async downloadRemote(id: string): Promise<Blob> {
    const provider = this.requireActiveProvider()
    return provider.downloadBackup(id)
  }

  // ---------- Restore ----------

  /**
   * Apply a parsed archive. Always snapshots the current dataset to local
   * safety storage first; never touches data if the safety snapshot fails.
   */
  async applyRestore(
    dataset: Dataset,
    meta: { source: string; manifest?: BackupManifest },
  ): Promise<{ safetyBackupId: string }> {
    const current = await this.docs.exportDataset()
    const datasetId = await this.ensureDatasetId()
    const safety = await buildBackupArchive(current, { datasetId })
    const safetyRecord = await this.docs.saveSafetyBackup(
      safety.blob,
      `恢复前自动备份：${meta.source}`,
    )
    await this.docs.createSnapshot('pre-restore').catch(() => undefined)
    await this.docs.replaceDataset(dataset)
    this.message = '恢复完成，已替换本地草稿'
    this.error = null
    this.emit()
    return { safetyBackupId: safetyRecord.id }
  }

  async listSafetyBackups() {
    return this.docs.listSafetyBackups()
  }

  // ---------- Automatic backups ----------

  private startScheduler(): void {
    if (this.ticker !== null) window.clearInterval(this.ticker)
    this.ticker = window.setInterval(() => {
      void this.maybeAutoBackup()
    }, TICK_MS)
  }

  /** Run the same check the 60s scheduler uses (manual/test entry point). */
  async checkAutoBackupNow(): Promise<void> {
    await this.maybeAutoBackup()
  }

  private async maybeAutoBackup(): Promise<void> {
    if (this.disposed || !this.ready || this.autoRunning || this.running) return
    if (!this.settings.autoBackup || !this.settings.providerId) return
    if (Date.now() < this.nextAutoAttemptAt) return
    const interval = this.settings.intervalMinutes * 60_000
    if (this.lastBackup && Date.now() - this.lastBackup.at < interval) return
    const revision = await this.docs.getDatasetRevision()
    if (this.lastBackup && revision <= this.lastBackup.datasetRevision) return
    const provider = this.providers[this.settings.providerId]
    if (!(await provider.isConnected())) return
    if (this.settings.encryptionEnabled && !this.sessionPassword) {
      this.error = '自动备份已启用加密，但本次会话没有记住密码；请到备份设置输入密码'
      this.emit()
      return
    }
    this.autoRunning = true
    try {
      await this.runBackup({ manual: false })
      this.autoFailures = 0
      this.nextAutoAttemptAt = 0
    } catch {
      // Error is exposed through state; back off so a broken provider is not
      // retried every minute.
      this.autoFailures += 1
      const backoffMs = Math.min(60 * 60_000, 5 * 60_000 * 2 ** (this.autoFailures - 1))
      this.nextAutoAttemptAt = Date.now() + backoffMs
    } finally {
      this.autoRunning = false
    }
  }
}

export type ProviderId = 'onedrive' | 'google-drive' | 'webdav' | 's3'

export interface RemoteBackupInfo {
  id: string
  name: string
  size: number
  modifiedAt: number
}

export interface UploadProgress {
  loaded: number
  total: number
}

export interface ProviderSettingsStore {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

export interface BackupProvider {
  readonly id: ProviderId
  readonly label: string
  readonly description: string
  /** Whether required configuration (client id / url / keys) is present. */
  isConfigured(): boolean
  /** Whether usable credentials are stored (does not hit the network). */
  isConnected(): Promise<boolean>
  /** Interactive authorization or credential validation. */
  connect(): Promise<void>
  disconnect(): Promise<void>
  listBackups(): Promise<RemoteBackupInfo[]>
  uploadBackup(
    name: string,
    data: Blob,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<RemoteBackupInfo>
  downloadBackup(id: string): Promise<Blob>
  deleteBackup(id: string): Promise<void>
}

export interface ProviderDescriptor {
  id: ProviderId
  label: string
  description: string
  configured: boolean
  connected: boolean
}

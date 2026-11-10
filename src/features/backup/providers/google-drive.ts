import { BACKUP_NAME_PREFIX, GOOGLE_DRIVE_SCOPE } from '@/shared/constants'
import { newId } from '@/core/utils'
import { BackupError } from '../errors'
import { createPkcePair, makeState, runOAuthPopup } from '../oauth/pkce'
import { resolveRedirectUri } from './oauth-utils'
import { fetchWithRetry } from './http'
import type {
  BackupProvider,
  ProviderSettingsStore,
  RemoteBackupInfo,
  UploadProgress,
} from './types'
import { isBackupFileName } from './onedrive'

interface GoogleTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

interface DriveFile {
  id: string
  name: string
  size?: string
  modifiedTime?: string
  createdTime?: string
}

const TOKENS_KEY = 'provider.google.tokens'
const VERIFIER_KEY = 'oauth.google.verifier'
const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export class GoogleDriveProvider implements BackupProvider {
  readonly id = 'google-drive' as const
  readonly label = 'Google Drive'
  readonly description = '存入 Drive 的应用数据文件夹（appDataFolder），普通 Drive 界面不可见'

  constructor(private readonly store: ProviderSettingsStore) {}

  private get clientId(): string {
    return String(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim()
  }

  private get redirectUri(): string {
    return resolveRedirectUri(
      import.meta.env.VITE_GOOGLE_REDIRECT_URI as string | undefined,
    )
  }

  isConfigured(): boolean {
    return this.clientId.length > 0
  }

  async isConnected(): Promise<boolean> {
    const tokens = await this.store.get<GoogleTokens>(TOKENS_KEY)
    return Boolean(tokens?.accessToken || tokens?.refreshToken)
  }

  async connect(): Promise<void> {
    if (!this.clientId) {
      throw new BackupError(
        'not-configured',
        '未配置 VITE_GOOGLE_CLIENT_ID。请先在 Google Cloud Console 创建 OAuth Web 客户端，并在 .env 中填写客户端 ID。',
      )
    }
    const { verifier, challenge } = await createPkcePair()
    const state = makeState('google-drive')
    sessionStorage.setItem(VERIFIER_KEY, verifier)
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: GOOGLE_DRIVE_SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    })
    let code: string
    try {
      const result = await runOAuthPopup('google-drive', `${AUTHORIZE_ENDPOINT}?${params}`, state)
      code = result.code
    } catch (error) {
      throw new BackupError(
        'auth',
        error instanceof Error ? error.message : 'Google Drive 授权失败',
        error,
      )
    } finally {
      sessionStorage.removeItem(VERIFIER_KEY)
    }
    const tokens = await this.exchangeCode(code, verifier)
    await this.store.set(TOKENS_KEY, tokens)
    try {
      const response = await this.drive('/about?fields=user', { method: 'GET' })
      if (!response.ok) throw await this.httpError(response, '验证 Google Drive 应用数据目录')
    } catch (error) {
      await this.store.delete(TOKENS_KEY)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    await this.store.delete(TOKENS_KEY)
    sessionStorage.removeItem(VERIFIER_KEY)
  }

  private async exchangeCode(code: string, verifier: string): Promise<GoogleTokens> {
    return this.tokenRequest(
      new URLSearchParams({
        client_id: this.clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
        code_verifier: verifier,
      }),
      '换取 Google Drive 登录令牌失败',
    )
  }

  private async tokenRequest(body: URLSearchParams, context: string): Promise<GoogleTokens> {
    let response: Response
    try {
      response = await fetchWithRetry(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
    } catch (error) {
      throw new BackupError('network', '无法连接 Google 登录服务，请检查网络', error)
    }
    if (!response.ok) {
      let detail = ''
      try {
        const payload = (await response.json()) as {
          error?: string | { message?: string }
          error_description?: string
        }
        detail =
          payload.error_description ||
          (typeof payload.error === 'string' ? payload.error : payload.error?.message) ||
          ''
      } catch {
        // Non-JSON error.
      }
      throw new BackupError(
        'auth',
        `${context}（HTTP ${response.status}）${detail ? `：${detail}` : ''}`,
      )
    }
    const payload = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }
    const previous = await this.store.get<GoogleTokens>(TOKENS_KEY)
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? previous?.refreshToken ?? '',
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    }
  }

  private async ensureAccessToken(forceRefresh = false): Promise<string> {
    const tokens = await this.store.get<GoogleTokens>(TOKENS_KEY)
    if (!tokens) throw new BackupError('auth', '请先连接 Google Drive')
    if (!forceRefresh && tokens.accessToken && tokens.expiresAt > Date.now() + 60_000) {
      return tokens.accessToken
    }
    if (!tokens.refreshToken) {
      throw new BackupError('auth', 'Google Drive 登录已过期，请重新连接')
    }
    const refreshed = await this.tokenRequest(
      new URLSearchParams({
        client_id: this.clientId,
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      }),
      '刷新 Google Drive 登录令牌失败',
    )
    await this.store.set(TOKENS_KEY, refreshed)
    return refreshed.accessToken
  }

  private async drive(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const token = await this.ensureAccessToken()
    let response: Response
    try {
      response = await fetchWithRetry(`${path.startsWith('http') ? path : `${DRIVE_API}${path}`}`, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          Authorization: `Bearer ${token}`,
        },
      })
    } catch (error) {
      throw new BackupError('network', '无法连接 Google Drive，请检查网络或代理设置', error)
    }
    if (response.status === 401 && retry) {
      await this.ensureAccessToken(true)
      return this.drive(path, init, false)
    }
    return response
  }

  private async httpError(response: Response, context: string): Promise<BackupError> {
    let detail = ''
    try {
      const payload = (await response.clone().json()) as {
        error?: { message?: string }
      }
      detail = payload.error?.message ?? ''
    } catch {
      // Non-JSON body.
    }
    const code =
      response.status === 401 || response.status === 403
        ? 'auth'
        : response.status === 404
          ? 'not-found'
          : 'network'
    return new BackupError(
      code,
      `${context}失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`,
    )
  }

  async listBackups(): Promise<RemoteBackupInfo[]> {
    const query = new URLSearchParams({
      spaces: 'appDataFolder',
      q: `name contains '${BACKUP_NAME_PREFIX}' and trashed = false`,
      fields: 'files(id,name,size,modifiedTime,createdTime)',
      pageSize: '100',
      orderBy: 'modifiedTime desc',
    })
    const response = await this.drive(`/files?${query}`)
    if (!response.ok) throw await this.httpError(response, '读取 Google Drive 备份列表')
    const payload = (await response.json()) as { files?: DriveFile[] }
    return (payload.files ?? [])
      .filter((file) => isBackupFileName(file.name))
      .map((file) => ({
        id: file.id,
        name: file.name,
        size: Number(file.size ?? 0),
        modifiedAt: Date.parse(file.modifiedTime ?? '') || 0,
      }))
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
  }

  async uploadBackup(
    name: string,
    data: Blob,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<RemoteBackupInfo> {
    if (!isBackupFileName(name)) {
      throw new BackupError('invalid-data', '备份文件名不符合 Scratch 命名规范')
    }
    const boundary = `scratch-${newId()}`
    const metadata = JSON.stringify({ name, parents: ['appDataFolder'] })
    const head = utf8(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/zip\r\n\r\n`,
    )
    const tail = utf8(`\r\n--${boundary}--`)
    const body = new Blob([head as BlobPart, data, tail as BlobPart], {
      type: `multipart/related; boundary=${boundary}`,
    })
    const query = new URLSearchParams({
      uploadType: 'multipart',
      fields: 'id,name,size,modifiedTime,createdTime',
    })
    const response = await this.drive(`${UPLOAD_API}/files?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    })
    if (!response.ok) throw await this.httpError(response, '上传 Google Drive 备份')
    onProgress?.({ loaded: data.size, total: data.size })
    const file = (await response.json()) as DriveFile
    return {
      id: file.id,
      name: file.name,
      size: Number(file.size ?? data.size),
      modifiedAt: Date.parse(file.modifiedTime ?? '') || Date.now(),
    }
  }

  async downloadBackup(id: string): Promise<Blob> {
    const response = await this.drive(`/files/${encodeURIComponent(id)}?alt=media`)
    if (!response.ok) throw await this.httpError(response, '下载 Google Drive 备份')
    return response.blob()
  }

  async deleteBackup(id: string): Promise<void> {
    const response = await this.drive(`/files/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (response.status === 404) throw new BackupError('not-found', '备份文件已不存在')
    if (!response.ok) throw await this.httpError(response, '删除 Google Drive 备份')
  }
}

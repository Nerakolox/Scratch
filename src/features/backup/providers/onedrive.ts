import { BACKUP_NAME_PREFIX, ONEDRIVE_SCOPE } from '@/shared/constants'
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

interface OneDriveTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

interface GraphItem {
  id: string
  name: string
  size?: number
  lastModifiedDateTime?: string
  createdDateTime?: string
}

const TOKENS_KEY = 'provider.onedrive.tokens'
const VERIFIER_KEY = 'oauth.onedrive.verifier'
const SMALL_UPLOAD_LIMIT = 4 * 1024 * 1024
const CHUNK_SIZE = 5 * 1024 * 1024

export function isBackupFileName(name: string): boolean {
  return name.startsWith(BACKUP_NAME_PREFIX) && name.endsWith('.scratchbackup')
}

export class OneDriveProvider implements BackupProvider {
  readonly id = 'onedrive' as const
  readonly label = 'OneDrive'
  readonly description = '通过 Microsoft Graph 存入应用专属文件夹，权限仅限本应用'

  constructor(private readonly store: ProviderSettingsStore) {}

  private get clientId(): string {
    return String(import.meta.env.VITE_ONEDRIVE_CLIENT_ID ?? '').trim()
  }

  private get tenant(): string {
    return String(import.meta.env.VITE_ONEDRIVE_TENANT ?? '').trim() || 'consumers'
  }

  private get redirectUri(): string {
    return resolveRedirectUri(
      import.meta.env.VITE_ONEDRIVE_REDIRECT_URI as string | undefined,
    )
  }

  private get authorizeEndpoint(): string {
    return `https://login.microsoftonline.com/${encodeURIComponent(this.tenant)}/oauth2/v2.0/authorize`
  }

  private get tokenEndpoint(): string {
    return `https://login.microsoftonline.com/${encodeURIComponent(this.tenant)}/oauth2/v2.0/token`
  }

  isConfigured(): boolean {
    return this.clientId.length > 0
  }

  async isConnected(): Promise<boolean> {
    const tokens = await this.store.get<OneDriveTokens>(TOKENS_KEY)
    return Boolean(tokens?.accessToken || tokens?.refreshToken)
  }

  async connect(): Promise<void> {
    if (!this.clientId) {
      throw new BackupError(
        'not-configured',
        '未配置 VITE_ONEDRIVE_CLIENT_ID。请先在 Microsoft Entra 注册 SPA 应用，并在 .env 中填写客户端 ID。',
      )
    }
    const { verifier, challenge } = await createPkcePair()
    const state = makeState('onedrive')
    sessionStorage.setItem(VERIFIER_KEY, verifier)
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      response_mode: 'query',
      scope: ONEDRIVE_SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    let code: string
    try {
      const result = await runOAuthPopup('onedrive', `${this.authorizeEndpoint}?${params}`, state)
      code = result.code
    } catch (error) {
      throw new BackupError(
        'auth',
        error instanceof Error ? error.message : 'OneDrive 授权失败',
        error,
      )
    } finally {
      sessionStorage.removeItem(VERIFIER_KEY)
    }
    const tokens = await this.exchangeCode(code, verifier)
    await this.store.set(TOKENS_KEY, tokens)
    // Verify App Folder access early so "connected" is honest. A failed
    // verification must not leave behind a token that looks connected.
    try {
      const response = await this.graph('/me/drive/special/approot?$select=id,name')
      if (!response.ok) throw await this.httpError(response, '验证 OneDrive 应用文件夹')
    } catch (error) {
      await this.store.delete(TOKENS_KEY)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    await this.store.delete(TOKENS_KEY)
    sessionStorage.removeItem(VERIFIER_KEY)
  }

  private async exchangeCode(code: string, verifier: string): Promise<OneDriveTokens> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      code_verifier: verifier,
      scope: ONEDRIVE_SCOPE,
    })
    return this.tokenRequest(body, '换取 OneDrive 登录令牌失败')
  }

  private async tokenRequest(body: URLSearchParams, context: string): Promise<OneDriveTokens> {
    let response: Response
    try {
      response = await fetchWithRetry(this.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
    } catch (error) {
      throw new BackupError('network', '无法连接 Microsoft 登录服务，请检查网络', error)
    }
    if (!response.ok) {
      let detail = ''
      try {
        const payload = (await response.json()) as {
          error?: string
          error_description?: string
        }
        detail = payload.error_description || payload.error || ''
      } catch {
        // Non-JSON error body.
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
    const previous = await this.store.get<OneDriveTokens>(TOKENS_KEY)
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? previous?.refreshToken ?? '',
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    }
  }

  private async ensureAccessToken(forceRefresh = false): Promise<string> {
    const tokens = await this.store.get<OneDriveTokens>(TOKENS_KEY)
    if (!tokens) throw new BackupError('auth', '请先连接 OneDrive')
    if (!forceRefresh && tokens.accessToken && tokens.expiresAt > Date.now() + 60_000) {
      return tokens.accessToken
    }
    if (!tokens.refreshToken) {
      throw new BackupError('auth', 'OneDrive 登录已过期，请重新连接')
    }
    const refreshed = await this.tokenRequest(
      new URLSearchParams({
        client_id: this.clientId,
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        scope: ONEDRIVE_SCOPE,
      }),
      '刷新 OneDrive 登录令牌失败',
    )
    await this.store.set(TOKENS_KEY, refreshed)
    return refreshed.accessToken
  }

  private async graph(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const token = await this.ensureAccessToken()
    let response: Response
    try {
      response = await fetchWithRetry(`https://graph.microsoft.com/v1.0${path}`, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          Authorization: `Bearer ${token}`,
        },
      })
    } catch (error) {
      throw new BackupError('network', '无法连接 OneDrive，请检查网络或代理设置', error)
    }
    if (response.status === 401 && retry) {
      await this.ensureAccessToken(true)
      return this.graph(path, init, false)
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
    const response = await this.graph(
      '/me/drive/special/approot/children?$select=id,name,size,lastModifiedDateTime,createdDateTime&$top=200',
    )
    if (!response.ok) throw await this.httpError(response, '读取 OneDrive 备份列表')
    const payload = (await response.json()) as { value?: GraphItem[] }
    return (payload.value ?? [])
      .filter((item) => isBackupFileName(item.name))
      .map((item) => ({
        id: item.id,
        name: item.name,
        size: item.size ?? 0,
        modifiedAt: Date.parse(item.lastModifiedDateTime ?? '') || 0,
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
    const encoded = encodeURIComponent(name)
    if (data.size <= SMALL_UPLOAD_LIMIT) {
      const response = await this.graph(
        `/me/drive/special/approot:/${encoded}:/content`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/zip' },
          body: data,
        },
      )
      if (!response.ok) throw await this.httpError(response, '上传 OneDrive 备份')
      onProgress?.({ loaded: data.size, total: data.size })
      const item = (await response.json()) as GraphItem
      return {
        id: item.id,
        name: item.name,
        size: item.size ?? data.size,
        modifiedAt: Date.parse(item.lastModifiedDateTime ?? '') || Date.now(),
      }
    }

    const sessionResponse = await this.graph(
      `/me/drive/special/approot:/${encoded}:/createUploadSession`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'fail' } }),
      },
    )
    if (!sessionResponse.ok) {
      throw await this.httpError(sessionResponse, '创建 OneDrive 上传会话')
    }
    const session = (await sessionResponse.json()) as { uploadUrl: string }
    let offset = 0
    let item: GraphItem | null = null
    while (offset < data.size) {
      const end = Math.min(offset + CHUNK_SIZE, data.size)
      const chunk = data.slice(offset, end)
      let response: Response
      try {
        response = await fetchWithRetry(session.uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Length': String(chunk.size),
            'Content-Range': `bytes ${offset}-${end - 1}/${data.size}`,
          },
          body: chunk,
        })
      } catch (error) {
        throw new BackupError('network', 'OneDrive 分片上传中断，请重试', error)
      }
      if (!response.ok) throw await this.httpError(response, 'OneDrive 分片上传')
      if (response.status === 200 || response.status === 201) {
        item = (await response.json()) as GraphItem
      }
      offset = end
      onProgress?.({ loaded: offset, total: data.size })
    }
    if (!item) {
      throw new BackupError('network', 'OneDrive 上传未返回文件信息')
    }
    return {
      id: item.id,
      name: item.name,
      size: item.size ?? data.size,
      modifiedAt: Date.parse(item.lastModifiedDateTime ?? '') || Date.now(),
    }
  }

  async downloadBackup(id: string): Promise<Blob> {
    const response = await this.graph(`/me/drive/items/${encodeURIComponent(id)}/content`)
    if (!response.ok) throw await this.httpError(response, '下载 OneDrive 备份')
    return response.blob()
  }

  async deleteBackup(id: string): Promise<void> {
    const response = await this.graph(`/me/drive/items/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    if (response.status === 404) throw new BackupError('not-found', '备份文件已不存在')
    if (!response.ok) throw await this.httpError(response, '删除 OneDrive 备份')
  }
}

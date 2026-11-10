import { BackupError } from '../errors'
import type {
  BackupProvider,
  ProviderSettingsStore,
  RemoteBackupInfo,
  UploadProgress,
} from './types'
import { isBackupFileName } from './onedrive'
import { fetchWithRetry } from './http'

export interface WebDavConfig {
  baseUrl: string
  username: string
  rememberPassword: boolean
  password?: string
  /** Set only after a successful PROPFIND/MKCOL-verified connection. */
  verified?: boolean
}

const CONFIG_KEY = 'provider.webdav.config'
const SESSION_PASSWORD_KEY = 'scratch:webdav:password'

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new BackupError('invalid-data', 'WebDAV 地址不是有效的 URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BackupError('invalid-data', 'WebDAV 地址必须使用 http(s)')
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}/`
}

function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

function basename(href: string): string {
  const clean = href.replace(/\/+$/, '')
  const index = clean.lastIndexOf('/')
  try {
    return decodeURIComponent(index >= 0 ? clean.slice(index + 1) : clean)
  } catch {
    return index >= 0 ? clean.slice(index + 1) : clean
  }
}

export class WebDavProvider implements BackupProvider {
  readonly id = 'webdav' as const
  readonly label = 'WebDAV'
  readonly description = 'Nextcloud、NAS 或任意支持 CORS 的 WebDAV 目录'

  constructor(private readonly store: ProviderSettingsStore) {}

  private async getConfig(): Promise<WebDavConfig | null> {
    const config = await this.store.get<WebDavConfig>(CONFIG_KEY)
    if (!config) return null
    if (!config.rememberPassword) {
      const password = sessionStorage.getItem(SESSION_PASSWORD_KEY)
      return { ...config, password: password ?? undefined }
    }
    return config
  }

  async readConfig(): Promise<Omit<WebDavConfig, 'password'> | null> {
    const config = await this.store.get<WebDavConfig>(CONFIG_KEY)
    if (!config) return null
    return {
      baseUrl: config.baseUrl,
      username: config.username,
      rememberPassword: config.rememberPassword,
      verified: config.verified === true,
    }
  }

  async configure(config: WebDavConfig): Promise<void> {
    const baseUrl = normalizeBaseUrl(config.baseUrl)
    if (!config.username.trim()) {
      throw new BackupError('invalid-data', '请填写 WebDAV 用户名')
    }
    if (!config.password) {
      throw new BackupError('invalid-data', '请填写 WebDAV 密码或应用密码')
    }
    const stored: WebDavConfig = {
      baseUrl,
      username: config.username.trim(),
      rememberPassword: config.rememberPassword,
      verified: false,
      ...(config.rememberPassword ? { password: config.password } : {}),
    }
    await this.store.set(CONFIG_KEY, stored)
    if (config.rememberPassword) {
      sessionStorage.removeItem(SESSION_PASSWORD_KEY)
    } else {
      sessionStorage.setItem(SESSION_PASSWORD_KEY, config.password)
    }
    await this.testConnection()
    await this.store.set(CONFIG_KEY, { ...stored, verified: true })
  }

  isConfigured(): boolean {
    // Credentials are loaded asynchronously; treat the stored config as
    // configured and let connect()/requests surface missing details.
    return true
  }

  async isConnected(): Promise<boolean> {
    const config = await this.getConfig()
    const stored = await this.store.get<WebDavConfig>(CONFIG_KEY)
    return Boolean(
      stored?.verified === true && config?.baseUrl && config.username && config.password,
    )
  }

  async connect(): Promise<void> {
    const config = await this.getConfig()
    if (!config) {
      throw new BackupError('not-configured', '请先填写 WebDAV 地址与账号')
    }
    if (!config.password) {
      throw new BackupError('auth', 'WebDAV 密码仅在本次会话保存，请重新填写')
    }
    await this.testConnection()
    const stored = await this.store.get<WebDavConfig>(CONFIG_KEY)
    if (stored) await this.store.set(CONFIG_KEY, { ...stored, verified: true })
  }

  async disconnect(): Promise<void> {
    await this.store.delete(CONFIG_KEY)
    sessionStorage.removeItem(SESSION_PASSWORD_KEY)
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const config = await this.getConfig()
    if (!config?.password) {
      throw new BackupError('not-configured', 'WebDAV 尚未配置')
    }
    return { Authorization: basicAuth(config.username, config.password) }
  }

  private async request(
    url: string,
    init: RequestInit,
    context: string,
  ): Promise<Response> {
    const auth = await this.authHeaders()
    let response: Response
    try {
      response = await fetchWithRetry(url, {
        ...init,
        headers: { ...(init.headers ?? {}), ...auth },
      })
    } catch (error) {
      throw new BackupError(
        'cors',
        '无法连接 WebDAV。纯静态网页只能访问允许当前来源跨域（CORS）的服务；请检查服务器 CORS 配置或使用同源代理。',
        error,
      )
    }
    if (response.status === 401 || response.status === 403) {
      throw new BackupError('auth', `${context}失败：WebDAV 账号无权限或密码错误`)
    }
    if (response.status === 507) {
      throw new BackupError('network', `${context}失败：WebDAV 存储空间不足`)
    }
    return response
  }

  async testConnection(): Promise<void> {
    const config = await this.getConfig()
    if (!config) throw new BackupError('not-configured', 'WebDAV 尚未配置')
    const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`
    let response = await this.request(
      config.baseUrl,
      { method: 'PROPFIND', headers: { Depth: '0', 'Content-Type': 'application/xml' }, body },
      '连接 WebDAV 目录',
    )
    if (response.status === 404) {
      const created = await this.request(config.baseUrl, { method: 'MKCOL' }, '创建 WebDAV 目录')
      if (!created.ok && created.status !== 405) {
        throw new BackupError('network', `创建 WebDAV 目录失败（HTTP ${created.status}）`)
      }
      response = await this.request(
        config.baseUrl,
        { method: 'PROPFIND', headers: { Depth: '0', 'Content-Type': 'application/xml' }, body },
        '连接 WebDAV 目录',
      )
    }
    if (!response.ok && response.status !== 207) {
      throw new BackupError('network', `WebDAV 目录不可用（HTTP ${response.status}）`)
    }
  }

  async listBackups(): Promise<RemoteBackupInfo[]> {
    const config = await this.getConfig()
    if (!config) throw new BackupError('not-configured', 'WebDAV 尚未配置')
    const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:getlastmodified/><d:resourcetype/></d:prop></d:propfind>`
    const response = await this.request(
      config.baseUrl,
      { method: 'PROPFIND', headers: { Depth: '1', 'Content-Type': 'application/xml' }, body },
      '读取 WebDAV 备份列表',
    )
    if (!response.ok && response.status !== 207) {
      throw new BackupError('network', `读取 WebDAV 目录失败（HTTP ${response.status}）`)
    }
    const text = await response.text()
    const xml = new DOMParser().parseFromString(text, 'application/xml')
    if (xml.querySelector('parsererror')) {
      throw new BackupError('invalid-data', 'WebDAV 返回的目录 XML 无法解析')
    }
    const results: RemoteBackupInfo[] = []
    for (const node of Array.from(xml.getElementsByTagNameNS('DAV:', 'response'))) {
      const href = node.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent?.trim()
      if (!href) continue
      const name = basename(href)
      if (!isBackupFileName(name)) continue
      const resourceType = node.getElementsByTagNameNS('DAV:', 'resourcetype')[0]
      if (resourceType?.getElementsByTagNameNS('DAV:', 'collection').length) continue
      const size = Number(
        node.getElementsByTagNameNS('DAV:', 'getcontentlength')[0]?.textContent ?? 0,
      )
      const modified = Date.parse(
        node.getElementsByTagNameNS('DAV:', 'getlastmodified')[0]?.textContent ?? '',
      )
      let absolute: string
      try {
        absolute = new URL(href, config.baseUrl).toString()
      } catch {
        continue
      }
      results.push({
        id: absolute,
        name,
        size: Number.isFinite(size) ? size : 0,
        modifiedAt: Number.isFinite(modified) ? modified : 0,
      })
    }
    return results.sort((a, b) => b.modifiedAt - a.modifiedAt)
  }

  async uploadBackup(
    name: string,
    data: Blob,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<RemoteBackupInfo> {
    if (!isBackupFileName(name)) {
      throw new BackupError('invalid-data', '备份文件名不符合 Scratch 命名规范')
    }
    const config = await this.getConfig()
    if (!config) throw new BackupError('not-configured', 'WebDAV 尚未配置')
    const url = `${config.baseUrl}${encodeURIComponent(name)}`
    const response = await this.request(
      url,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/zip' },
        body: data,
      },
      '上传 WebDAV 备份',
    )
    if (!response.ok) {
      throw new BackupError('network', `上传 WebDAV 备份失败（HTTP ${response.status}）`)
    }
    onProgress?.({ loaded: data.size, total: data.size })
    return { id: url, name, size: data.size, modifiedAt: Date.now() }
  }

  async downloadBackup(id: string): Promise<Blob> {
    const response = await this.request(id, { method: 'GET' }, '下载 WebDAV 备份')
    if (!response.ok) {
      if (response.status === 404) throw new BackupError('not-found', 'WebDAV 备份文件不存在')
      throw new BackupError('network', `下载 WebDAV 备份失败（HTTP ${response.status}）`)
    }
    return response.blob()
  }

  async deleteBackup(id: string): Promise<void> {
    const response = await this.request(id, { method: 'DELETE' }, '删除 WebDAV 备份')
    if (response.status === 404) throw new BackupError('not-found', 'WebDAV 备份文件不存在')
    if (!response.ok) {
      throw new BackupError('network', `删除 WebDAV 备份失败（HTTP ${response.status}）`)
    }
  }
}

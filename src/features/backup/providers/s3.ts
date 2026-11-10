import { BackupError } from '../errors'
import type {
  BackupProvider,
  ProviderSettingsStore,
  RemoteBackupInfo,
  UploadProgress,
} from './types'
import { isBackupFileName } from './onedrive'
import { EMPTY_PAYLOAD_SHA256, signS3Request } from './s3-signer'
import { fetchWithRetry } from './http'
import { sha256Hex } from '../archive/hash'
import { BACKUP_NAME_PREFIX } from '@/shared/constants'

export interface S3Config {
  endpoint: string
  region: string
  bucket: string
  prefix: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  /** Set only after a successful signed ListObjectsV2 request. */
  verified?: boolean
}

const CONFIG_KEY = 'provider.s3.config'

function normalizeConfig(input: S3Config): S3Config {
  let endpoint: URL
  try {
    endpoint = new URL(input.endpoint.trim())
  } catch {
    throw new BackupError('invalid-data', 'S3 Endpoint 不是有效的 URL')
  }
  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
    throw new BackupError('invalid-data', 'S3 Endpoint 必须使用 http(s)')
  }
  if (endpoint.pathname.replace(/\/+$/, '') !== '') {
    throw new BackupError('invalid-data', 'S3 Endpoint 只填写域名，不要包含 Bucket 路径')
  }
  const bucket = input.bucket.trim()
  if (!bucket) throw new BackupError('invalid-data', '请填写 Bucket 名称')
  const region = input.region.trim() || 'auto'
  const prefix = input.prefix.trim().replace(/^\/+|\/+$/g, '')
  if (!input.accessKeyId.trim() || !input.secretAccessKey.trim()) {
    throw new BackupError('invalid-data', '请填写 Access Key 与 Secret Key')
  }
  return {
    endpoint: endpoint.origin,
    region,
    bucket,
    prefix: prefix ? `${prefix}/` : '',
    accessKeyId: input.accessKeyId.trim(),
    secretAccessKey: input.secretAccessKey.trim(),
    ...(input.sessionToken?.trim() ? { sessionToken: input.sessionToken.trim() } : {}),
  }
}

export class S3Provider implements BackupProvider {
  readonly id = 's3' as const
  readonly label = 'S3 兼容存储'
  readonly description = 'AWS S3、Cloudflare R2、MinIO 等；Bucket 需允许当前站点 CORS'

  constructor(private readonly store: ProviderSettingsStore) {}

  async readConfig(): Promise<S3Config | null> {
    return (await this.store.get<S3Config>(CONFIG_KEY)) ?? null
  }

  async configure(input: S3Config): Promise<void> {
    const config = normalizeConfig(input)
    await this.store.set(CONFIG_KEY, { ...config, verified: false })
    await this.testConnection()
    await this.store.set(CONFIG_KEY, { ...config, verified: true })
  }

  isConfigured(): boolean {
    return true
  }

  async isConnected(): Promise<boolean> {
    const config = await this.readConfig()
    return Boolean(
      config?.verified === true && config.endpoint && config.bucket && config.accessKeyId,
    )
  }

  async connect(): Promise<void> {
    const config = await this.readConfig()
    if (!config) throw new BackupError('not-configured', '请先填写 S3 兼容存储配置')
    await this.testConnection()
    await this.store.set(CONFIG_KEY, { ...config, verified: true })
  }

  async disconnect(): Promise<void> {
    await this.store.delete(CONFIG_KEY)
  }

  private async requireConfig(): Promise<S3Config> {
    const config = await this.readConfig()
    if (!config) throw new BackupError('not-configured', 'S3 兼容存储尚未配置')
    return config
  }

  private objectUrl(config: S3Config, key: string): URL {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/')
    return new URL(
      `${config.endpoint}/${encodeURIComponent(config.bucket)}/${encodedKey}`,
    )
  }

  private async signedRequest(
    config: S3Config,
    method: string,
    url: URL,
    options: { body?: Blob; payloadHash?: string; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const payloadHash =
      options.payloadHash ??
      (options.body ? await sha256Hex(new Uint8Array(await options.body.arrayBuffer())) : EMPTY_PAYLOAD_SHA256)
    const headers = await signS3Request({
      method,
      url,
      payloadHash,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region,
      sessionToken: config.sessionToken,
      headers: options.headers,
    })
    try {
      return await fetchWithRetry(url.toString(), {
        method,
        headers,
        body: options.body,
      })
    } catch (error) {
      throw new BackupError(
        'cors',
        '无法连接 S3 兼容存储。请确认 Bucket 已配置允许本站点的 CORS（含 PUT/GET/DELETE/HEAD），并检查 Endpoint 与网络。',
        error,
      )
    }
  }

  private async httpError(response: Response, context: string): Promise<BackupError> {
    let detail = ''
    try {
      const text = await response.clone().text()
      const match = text.match(/<Message>([^<]{0,300})<\/Message>/)
      if (match) detail = match[1]
    } catch {
      // Ignore body.
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

  async testConnection(): Promise<void> {
    await this.listBackups()
  }

  async listBackups(): Promise<RemoteBackupInfo[]> {
    const config = await this.requireConfig()
    const url = new URL(`${config.endpoint}/${encodeURIComponent(config.bucket)}`)
    url.searchParams.set('list-type', '2')
    url.searchParams.set('prefix', `${config.prefix}${BACKUP_NAME_PREFIX}`)
    url.searchParams.set('max-keys', '1000')
    const response = await this.signedRequest(config, 'GET', url, {
      payloadHash: EMPTY_PAYLOAD_SHA256,
    })
    if (!response.ok) throw await this.httpError(response, '读取 S3 备份列表')
    const text = await response.text()
    const xml = new DOMParser().parseFromString(text, 'application/xml')
    if (xml.querySelector('parsererror')) {
      throw new BackupError('invalid-data', 'S3 返回的 XML 无法解析')
    }
    const results: RemoteBackupInfo[] = []
    for (const node of Array.from(xml.getElementsByTagName('Contents'))) {
      const key = node.getElementsByTagName('Key')[0]?.textContent ?? ''
      const name = key.startsWith(config.prefix) ? key.slice(config.prefix.length) : key
      if (!isBackupFileName(name)) continue
      const size = Number(node.getElementsByTagName('Size')[0]?.textContent ?? 0)
      const modified = Date.parse(node.getElementsByTagName('LastModified')[0]?.textContent ?? '')
      results.push({
        id: key,
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
    const config = await this.requireConfig()
    const key = `${config.prefix}${name}`
    const url = this.objectUrl(config, key)
    const payloadHash = await sha256Hex(new Uint8Array(await data.arrayBuffer()))
    const response = await this.signedRequest(config, 'PUT', url, {
      body: data,
      payloadHash,
      headers: { 'content-type': 'application/zip' },
    })
    if (!response.ok) throw await this.httpError(response, '上传 S3 备份')
    onProgress?.({ loaded: data.size, total: data.size })
    return { id: key, name, size: data.size, modifiedAt: Date.now() }
  }

  async downloadBackup(id: string): Promise<Blob> {
    const config = await this.requireConfig()
    const url = this.objectUrl(config, id)
    const response = await this.signedRequest(config, 'GET', url, {
      payloadHash: EMPTY_PAYLOAD_SHA256,
    })
    if (!response.ok) {
      if (response.status === 404) throw new BackupError('not-found', 'S3 备份对象不存在')
      throw await this.httpError(response, '下载 S3 备份')
    }
    return response.blob()
  }

  async deleteBackup(id: string): Promise<void> {
    const config = await this.requireConfig()
    const url = this.objectUrl(config, id)
    const response = await this.signedRequest(config, 'DELETE', url, {
      payloadHash: EMPTY_PAYLOAD_SHA256,
    })
    if (response.status === 404) throw new BackupError('not-found', 'S3 备份对象不存在')
    if (!response.ok) throw await this.httpError(response, '删除 S3 备份')
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { OneDriveProvider } from '@/features/backup/providers/onedrive'
import { GoogleDriveProvider } from '@/features/backup/providers/google-drive'
import { WebDavProvider } from '@/features/backup/providers/webdav'
import { S3Provider } from '@/features/backup/providers/s3'
import type { ProviderSettingsStore } from '@/features/backup/providers/types'

const BACKUP_NAME = 'scratchbackup-20261110T120000Z-abcdef12.scratchbackup'

class MemoryStore implements ProviderSettingsStore {
  private data = new Map<string, unknown>()
  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }
  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key)
  }
}

interface FakeResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
  blob: () => Promise<Blob>
  clone: () => FakeResponse
}

function jsonResponse(payload: unknown, status = 200): FakeResponse {
  const response: FakeResponse = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    blob: async () => new Blob([JSON.stringify(payload)]),
    clone: () => response,
  }
  return response
}

function textResponse(text: string, status = 200): FakeResponse {
  const response: FakeResponse = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
    blob: async () => new Blob([text]),
    clone: () => response,
  }
  return response
}

function blobResponse(bytes: number[], status = 200): FakeResponse {
  const response: FakeResponse = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
    text: async () => new TextDecoder().decode(new Uint8Array(bytes)),
    blob: async () => new Blob([new Uint8Array(bytes) as BlobPart]),
    clone: () => response,
  }
  return response
}

function emptyResponse(status = 204): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
    text: async () => '',
    blob: async () => new Blob([]),
    clone: () => {},
  } as unknown as FakeResponse
}

function installFetch(
  handler: (url: string, init: RequestInit) => FakeResponse | Promise<FakeResponse>,
) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init ?? {}),
  )
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('OneDrive provider (mock Graph API)', () => {
  it('lists only Scratch backups and performs upload/download/delete with bearer auth', async () => {
    vi.stubEnv('VITE_ONEDRIVE_CLIENT_ID', 'test-client')
    const store = new MemoryStore()
    await store.set('provider.onedrive.tokens', {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3_600_000,
    })
    const provider = new OneDriveProvider(store)
    const fetchMock = installFetch((url, init) => {
      if (url.includes('/children?')) {
        return jsonResponse({
          value: [
            {
              id: 'file-1',
              name: BACKUP_NAME,
              size: 1024,
              lastModifiedDateTime: '2026-11-10T12:00:00Z',
            },
            { id: 'file-2', name: 'notes.txt', size: 5 },
          ],
        })
      }
      if (url.includes('/content') && (!init.method || init.method === 'GET')) {
        return blobResponse([1, 2, 3])
      }
      if (init.method === 'PUT') {
        return jsonResponse({
          id: 'file-3',
          name: BACKUP_NAME,
          size: 11,
          lastModifiedDateTime: '2026-11-10T12:05:00Z',
        })
      }
      if (init.method === 'DELETE') return emptyResponse(204)
      return jsonResponse({ error: { message: 'unexpected' } }, 500)
    })

    const list = await provider.listBackups()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'file-1', name: BACKUP_NAME, size: 1024 })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/me/drive/special/approot/children')
    const listHeaders = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >
    expect(listHeaders.Authorization).toBe('Bearer access-token')

    const info = await provider.uploadBackup(BACKUP_NAME, new Blob(['hello world']))
    expect(info.id).toBe('file-3')
    const putCall = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit)?.method === 'PUT',
    )!
    expect(String(putCall[0])).toContain(
      `/me/drive/special/approot:/${encodeURIComponent(BACKUP_NAME)}:/content`,
    )

    const downloaded = await provider.downloadBackup('file-1')
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))

    await provider.deleteBackup('file-1')
    const deleteCall = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit)?.method === 'DELETE',
    )!
    expect(String(deleteCall[0])).toContain('/me/drive/items/file-1')
  })
})

describe('Google Drive provider (mock API)', () => {
  it('uses appDataFolder, filters names, and performs multipart upload', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'google-client')
    const store = new MemoryStore()
    await store.set('provider.google.tokens', {
      accessToken: 'google-token',
      refreshToken: 'google-refresh',
      expiresAt: Date.now() + 3_600_000,
    })
    const provider = new GoogleDriveProvider(store)
    const fetchMock = installFetch((url, init) => {
      if (url.includes('/drive/v3/files?') && (!init.method || init.method === 'GET')) {
        return jsonResponse({
          files: [
            {
              id: 'g1',
              name: BACKUP_NAME,
              size: '2048',
              modifiedTime: '2026-11-10T12:00:00Z',
            },
            { id: 'g2', name: 'other.txt', size: '2' },
          ],
        })
      }
      if (url.includes('upload/drive/v3/files')) {
        return jsonResponse({
          id: 'g3',
          name: BACKUP_NAME,
          size: '11',
          modifiedTime: '2026-11-10T12:05:00Z',
        })
      }
      if (init.method === 'DELETE') return emptyResponse(204)
      if (url.includes('alt=media')) return blobResponse([9, 8, 7])
      return jsonResponse({ error: { message: 'unexpected' } }, 500)
    })

    const list = await provider.listBackups()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'g1', size: 2048 })
    const listUrl = String(fetchMock.mock.calls[0][0])
    expect(listUrl).toContain('spaces=appDataFolder')
    expect(listUrl).toContain('scratchbackup-')

    const info = await provider.uploadBackup(BACKUP_NAME, new Blob(['hello world']))
    expect(info.id).toBe('g3')
    const uploadCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes('uploadType=multipart'),
    )!
    const body = (uploadCall[1] as RequestInit).body as Blob
    expect(await body.text()).toContain('appDataFolder')
    const uploadHeaders = (uploadCall[1] as RequestInit).headers as Record<string, string>
    expect(uploadHeaders['Content-Type']).toContain('multipart/related')

    expect((await provider.downloadBackup('g1')).size).toBe(3)
    await provider.deleteBackup('g1')
    expect(
      fetchMock.mock.calls.some(
        (call) => (call[1] as RequestInit)?.method === 'DELETE',
      ),
    ).toBe(true)
  })
})

describe('WebDAV provider (mock server)', () => {
  it('parses PROPFIND listings and uploads with basic auth', async () => {
    const store = new MemoryStore()
    const provider = new WebDavProvider(store)
    const listingXml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote/Scratch/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote/Scratch/${BACKUP_NAME}</d:href>
    <d:propstat><d:prop>
      <d:getcontentlength>4096</d:getcontentlength>
      <d:getlastmodified>Tue, 10 Nov 2026 12:00:00 GMT</d:getlastmodified>
      <d:resourcetype/>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote/Scratch/readme.txt</d:href>
    <d:propstat><d:prop><d:getcontentlength>1</d:getcontentlength><d:resourcetype/></d:prop></d:propstat>
  </d:response>
</d:multistatus>`
    const fetchMock = installFetch((_url, init) => {
      if (init.method === 'PROPFIND') {
        const headers = init.headers as Record<string, string>
        return textResponse(headers.Depth === '1' ? listingXml : '', 207)
      }
      if (init.method === 'PUT') return emptyResponse(201)
      if (init.method === 'DELETE') return emptyResponse(204)
      if (init.method === 'GET') return blobResponse([4, 5])
      return emptyResponse(500)
    })

    await provider.configure({
      baseUrl: 'https://dav.example.com/remote/Scratch',
      username: 'alice',
      password: 'app-password',
      rememberPassword: true,
    })
    const list = await provider.listBackups()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe(BACKUP_NAME)
    expect(list[0].size).toBe(4096)
    expect(list[0].id).toContain(BACKUP_NAME)

    await provider.uploadBackup(BACKUP_NAME, new Blob(['hello']))
    const putCall = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit)?.method === 'PUT',
    )!
    const putHeaders = (putCall[1] as RequestInit).headers as Record<string, string>
    expect(putHeaders.Authorization).toMatch(/^Basic /)
    expect(String(putCall[0])).toContain(encodeURIComponent(BACKUP_NAME))

    expect((await provider.downloadBackup(list[0].id)).size).toBe(2)
    await provider.deleteBackup(list[0].id)
  })
})

describe('S3-compatible provider (mock bucket)', () => {
  it('signs list/upload/delete requests and parses ListObjectsV2 XML', async () => {
    const store = new MemoryStore()
    await store.set('provider.s3.config', {
      endpoint: 'https://s3.example.com',
      region: 'auto',
      bucket: 'scratch-bucket',
      prefix: 'backups/',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'secret-key',
    })
    const provider = new S3Provider(store)
    const listXml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Contents>
    <Key>backups/${BACKUP_NAME}</Key>
    <LastModified>2026-11-10T12:00:00.000Z</LastModified>
    <Size>512</Size>
  </Contents>
  <Contents>
    <Key>backups/other.txt</Key>
    <LastModified>2026-11-10T12:00:00.000Z</LastModified>
    <Size>1</Size>
  </Contents>
</ListBucketResult>`
    const fetchMock = installFetch((_url, init) => {
      if ((init.method ?? 'GET') === 'GET' && _url.includes('list-type=2')) {
        return textResponse(listXml, 200)
      }
      if ((init.method ?? 'GET') === 'GET') return blobResponse([6, 7, 8])
      if (init.method === 'PUT') return emptyResponse(200)
      if (init.method === 'DELETE') return emptyResponse(204)
      return emptyResponse(500)
    })

    const list = await provider.listBackups()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: BACKUP_NAME, size: 512 })
    const listCall = fetchMock.mock.calls[0]
    const listUrl = new URL(String(listCall[0]))
    expect(listUrl.searchParams.get('prefix')).toBe('backups/scratchbackup-')
    const listHeaders = (listCall[1] as RequestInit).headers as Record<string, string>
    expect(listHeaders.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request/,
    )

    const info = await provider.uploadBackup(BACKUP_NAME, new Blob(['hello world']))
    expect(info.id).toBe(`backups/${BACKUP_NAME}`)
    const putCall = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit)?.method === 'PUT',
    )!
    expect(String(putCall[0])).toContain(`backups/${BACKUP_NAME}`)
    const putHeaders = (putCall[1] as RequestInit).headers as Record<string, string>
    expect(putHeaders['x-amz-content-sha256']).toMatch(/^[a-f0-9]{64}$/)

    expect((await provider.downloadBackup(`backups/${BACKUP_NAME}`)).size).toBe(3)
    await provider.deleteBackup(`backups/${BACKUP_NAME}`)
  })
})

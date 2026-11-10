import { sha256Hex, toHex, utf8 } from '../archive/hash'

export const EMPTY_PAYLOAD_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

export interface SignS3Options {
  method: string
  url: URL
  payloadHash: string
  accessKeyId: string
  secretAccessKey: string
  region: string
  sessionToken?: string
  headers?: Record<string, string>
  date?: Date
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function canonicalUri(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => {
      let decoded = segment
      try {
        decoded = decodeURIComponent(segment)
      } catch {
        // Keep raw segment.
      }
      return encodeRfc3986(decoded)
    })
    .join('/')
}

function canonicalQuery(url: URL): string {
  return [...url.searchParams.entries()]
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
}

function amzDate(date: Date): { full: string; short: string } {
  const full = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { full, short: full.slice(0, 8) }
}

async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, utf8(data) as BufferSource))
}

/**
 * AWS Signature Version 4 for S3-compatible endpoints. Path-style requests.
 * Returns the headers to send (host is signed but left to the browser).
 */
export async function signS3Request(options: SignS3Options): Promise<Record<string, string>> {
  const date = options.date ?? new Date()
  const { full, short } = amzDate(date)
  const host = options.url.host
  const provided: Record<string, string> = {}
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    const lower = name.toLowerCase()
    if (lower === 'host' || lower === 'authorization') continue
    provided[lower] = value.trim()
  }
  provided.host = host
  provided['x-amz-date'] = full
  provided['x-amz-content-sha256'] = options.payloadHash
  if (options.sessionToken) provided['x-amz-security-token'] = options.sessionToken

  const names = Object.keys(provided).sort()
  const canonicalHeaders = names.map((name) => `${name}:${provided[name]}\n`).join('')
  const signedHeaders = names.join(';')

  const canonicalRequest = [
    options.method.toUpperCase(),
    canonicalUri(options.url.pathname),
    canonicalQuery(options.url),
    canonicalHeaders,
    signedHeaders,
    options.payloadHash,
  ].join('\n')

  const scope = `${short}/${options.region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    full,
    scope,
    await sha256Hex(utf8(canonicalRequest)),
  ].join('\n')

  const kDate = await hmacSha256(utf8(`AWS4${options.secretAccessKey}`), short)
  const kRegion = await hmacSha256(kDate, options.region)
  const kService = await hmacSha256(kRegion, 's3')
  const kSigning = await hmacSha256(kService, 'aws4_request')
  const signature = toHex(await hmacSha256(kSigning, stringToSign))

  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(provided)) {
    if (name !== 'host') result[name] = value
  }
  result.Authorization = `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return result
}

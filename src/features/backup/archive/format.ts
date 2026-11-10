import type { z } from 'zod'
import type { ContentBlock, Dataset, MediaAsset } from '@/core/models/types'
import {
  canvasLayoutSchema,
  contentBlockSchema,
  manifestSchema,
  paperLayoutSchema,
  scratchSchema,
  encryptedHeaderSchema,
} from '@/core/schemas'
import { collectAssetIds } from '@/core/content'
import {
  APP_VERSION,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_NAME_PREFIX,
  ENCRYPTED_FORMAT,
} from '@/shared/constants'
import { BackupError } from '../errors'
import { encryptBackup, decryptBackup } from '../encryption/crypto'
import { buildZip, DEFAULT_LIMITS, inspectZip, readZipEntries, type ArchiveLimits } from './zip'
import { sha256Hex, utf8 } from './hash'
import { newId } from '@/core/utils'

export type BackupManifest = z.infer<typeof manifestSchema>

export interface BuildBackupOptions {
  datasetId: string
  password?: string
  appVersion?: string
}

export interface BuildBackupResult {
  blob: Blob
  manifest: BackupManifest
  encrypted: boolean
  filename: string
}

export interface ParseBackupOptions {
  password?: string
  limits?: Partial<ArchiveLimits>
}

export interface ParseBackupResult {
  dataset: Dataset
  manifest: BackupManifest
  warnings: string[]
  encrypted: boolean
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  heic: 'image/heic',
  bin: 'application/octet-stream',
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/heic': 'heic',
}

export const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/

function assertSafeId(id: string, label: string): void {
  if (!SAFE_ID_PATTERN.test(id)) {
    throw new BackupError('invalid-data', `${label} 包含非法字符`)
  }
}

function assetFileName(asset: MediaAsset): string {
  assertSafeId(asset.id, '图片资源 ID')
  const extension =
    EXTENSION_BY_MIME[asset.mimeType] ??
    (asset.mimeType.startsWith('image/') ? asset.mimeType.slice(6).replace(/[^a-z0-9]/g, '') : 'bin')
  return `${asset.id}.${extension || 'bin'}`
}

function magicMatches(mimeType: string, bytes: Uint8Array): boolean {
  const startsWith = (signature: number[], offset = 0) =>
    signature.every((value, index) => bytes[offset + index] === value)
  const ascii = (start: number, length: number) =>
    new TextDecoder('latin1').decode(bytes.subarray(start, start + length))
  switch (mimeType) {
    case 'image/png':
      return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/jpeg':
      return startsWith([0xff, 0xd8, 0xff])
    case 'image/gif':
      return ascii(0, 4) === 'GIF8'
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP'
    case 'image/avif':
      return ascii(4, 4) === 'ftyp' && (ascii(8, 4) === 'avif' || ascii(8, 4) === 'avis')
    case 'image/heic':
      return (
        ascii(4, 4) === 'ftyp' &&
        ['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(ascii(8, 4))
      )
    case 'image/svg+xml': {
      const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart()
      return head.startsWith('<svg') || head.startsWith('<?xml')
    }
    case 'application/octet-stream':
      return true
    default:
      return true
  }
}

function decodeJson(bytes: Uint8Array, label: string, limits: ArchiveLimits): unknown {
  if (bytes.byteLength > limits.maxJsonBytes) {
    throw new BackupError('too-large', `${label} 超过 JSON 大小限制`)
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new BackupError('invalid-format', `${label} 不是有效的 UTF-8 文本`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new BackupError('invalid-format', `${label} 不是有效 JSON`)
  }
}

function parseWith<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new BackupError('invalid-data', `${label} 的数据结构不符合备份规范`)
  }
  return result.data
}

async function computePayloadHash(
  entries: Array<{ name: string; bytes: Uint8Array }>,
): Promise<string> {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const chunks: string[] = []
  for (const entry of sorted) {
    chunks.push(`${entry.name}\n${await sha256Hex(entry.bytes)}\n`)
  }
  return sha256Hex(utf8(chunks.join('')))
}

export function backupFilename(date = new Date()): string {
  const stamp = date.toISOString().slice(0, 19).replace(/[-:]/g, '')
  const suffix = newId().slice(0, 8)
  return `${BACKUP_NAME_PREFIX}${stamp}Z-${suffix}.scratchbackup`
}

export async function buildBackupArchive(
  dataset: Dataset,
  options: BuildBackupOptions,
): Promise<BuildBackupResult> {
  const { scratches, blocks, paperLayouts, canvasLayouts, assets } = dataset

  // Validate each record so a corrupted local DB cannot silently produce a bad archive.
  for (const scratch of scratches) parseWith(scratchSchema, scratch, '草稿')
  for (const block of blocks) parseWith(contentBlockSchema, block, '内容块')
  for (const layout of paperLayouts) parseWith(paperLayoutSchema, layout, '纸张布局')
  for (const layout of canvasLayouts) parseWith(canvasLayoutSchema, layout, '画布布局')

  const files: Record<string, Uint8Array> = {
    'scratches.json': utf8(JSON.stringify(scratches)),
    'blocks.json': utf8(JSON.stringify(blocks)),
    'paper-layouts.json': utf8(JSON.stringify(paperLayouts)),
    'canvas-layouts.json': utf8(JSON.stringify(canvasLayouts)),
  }

  for (const asset of assets) {
    const name = assetFileName(asset)
    files[`assets/${name}`] = asset.bytes
  }

  const payloadSha256 = await computePayloadHash(
    Object.entries(files).map(([name, bytes]) => ({ name, bytes })),
  )

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: options.appVersion ?? APP_VERSION,
    datasetId: options.datasetId,
    scratchCount: scratches.length,
    assetCount: assets.length,
    payloadSha256,
  }
  files['manifest.json'] = utf8(JSON.stringify(manifest))

  const innerZip = buildZip(files)
  const filename = backupFilename()

  if (options.password) {
    const { cipher, header } = await encryptBackup(innerZip, options.password)
    const outerZip = buildZip(
      {
        'header.json': utf8(JSON.stringify(header)),
        'payload.bin': cipher,
      },
      false,
    )
    return {
      blob: new Blob([outerZip as BlobPart], { type: 'application/zip' }),
      manifest,
      encrypted: true,
      filename,
    }
  }

  return {
    blob: new Blob([innerZip as BlobPart], { type: 'application/zip' }),
    manifest,
    encrypted: false,
    filename,
  }
}

export async function parseBackupArchive(
  input: Blob | Uint8Array,
  options: ParseBackupOptions = {},
): Promise<ParseBackupResult> {
  const limits: ArchiveLimits = { ...DEFAULT_LIMITS, ...options.limits }
  const bytes =
    input instanceof Blob
      ? new Uint8Array(await input.arrayBuffer())
      : input
  if (bytes.byteLength > limits.maxArchiveBytes) {
    throw new BackupError('too-large', '备份文件超过大小限制')
  }

  const outerInfo = inspectZip(bytes, limits)
  const hasHeader = outerInfo.some((entry) => entry.name === 'header.json')
  let innerBytes = bytes
  let encrypted = false

  if (hasHeader) {
    encrypted = true
    const outerEntries = readZipEntries(bytes, limits)
    const headerBytes = outerEntries['header.json']
    if (!headerBytes) throw new BackupError('invalid-format', '加密备份头缺失')
    const header = parseWith(
      encryptedHeaderSchema,
      decodeJson(headerBytes, '加密头', limits),
      '加密头',
    )
    if (header.format !== ENCRYPTED_FORMAT) {
      throw new BackupError('invalid-format', '加密备份格式标识不正确')
    }
    const payload = outerEntries['payload.bin']
    if (!payload) throw new BackupError('invalid-format', '加密备份缺少密文负载')
    if (!options.password) {
      throw new BackupError('password-required', '该备份已加密，请输入密码')
    }
    innerBytes = await decryptBackup(payload, header, options.password)
  }

  const files = readZipEntries(innerBytes, limits)
  const manifestBytes = files['manifest.json']
  if (!manifestBytes) {
    throw new BackupError('invalid-format', '备份缺少 manifest.json')
  }
  const rawManifest = decodeJson(manifestBytes, 'manifest.json', limits)
  if (!rawManifest || typeof rawManifest !== 'object') {
    throw new BackupError('invalid-format', 'manifest.json 不是对象')
  }
  const manifestRecord = rawManifest as Record<string, unknown>
  if (manifestRecord.format !== BACKUP_FORMAT) {
    throw new BackupError('invalid-format', '这不是 Scratch 备份文件')
  }
  if (manifestRecord.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupError(
      'unsupported-version',
      `备份格式版本 ${String(manifestRecord.formatVersion)} 不受支持（当前支持 v${BACKUP_FORMAT_VERSION}）`,
    )
  }
  const manifest = parseWith(manifestSchema, rawManifest, 'manifest.json')

  const computedHash = await computePayloadHash(
    Object.entries(files)
      .filter(([name]) => name !== 'manifest.json')
      .map(([name, entryBytes]) => ({ name, bytes: entryBytes })),
  )
  if (computedHash !== manifest.payloadSha256) {
    throw new BackupError('invalid-data', '备份完整性校验失败，文件可能被修改或损坏')
  }

  const warnings: string[] = []
  const scratches = parseWith(
    scratchSchema.array(),
    decodeJson(requiredFile(files, 'scratches.json'), 'scratches.json', limits),
    'scratches.json',
  )
  const blocks = parseWith(
    contentBlockSchema.array(),
    decodeJson(requiredFile(files, 'blocks.json'), 'blocks.json', limits),
    'blocks.json',
  )
  const paperLayouts = parseWith(
    paperLayoutSchema.array(),
    decodeJson(requiredFile(files, 'paper-layouts.json'), 'paper-layouts.json', limits),
    'paper-layouts.json',
  )
  const canvasLayouts = parseWith(
    canvasLayoutSchema.array(),
    decodeJson(requiredFile(files, 'canvas-layouts.json'), 'canvas-layouts.json', limits),
    'canvas-layouts.json',
  )

  if (manifest.scratchCount !== scratches.length) {
    throw new BackupError('invalid-data', '备份中的草稿数量与清单不一致')
  }

  // ---- Assets ----
  const assets: Array<MediaAsset & { bytes: Uint8Array }> = []
  const assetIds = new Set<string>()
  for (const [name, assetBytes] of Object.entries(files)) {
    if (!name.startsWith('assets/')) continue
    const relative = name.slice('assets/'.length)
    const dot = relative.lastIndexOf('.')
    if (dot <= 0) {
      throw new BackupError('invalid-data', `图片文件名非法：${relative}`)
    }
    const id = relative.slice(0, dot)
    const extension = relative.slice(dot + 1).toLocaleLowerCase()
    assertSafeId(id, '图片资源 ID')
    if (assetIds.has(id)) {
      throw new BackupError('invalid-data', '备份中存在重复的图片资源 ID')
    }
    assetIds.add(id)
    const mimeType = MIME_BY_EXTENSION[extension]
    if (!mimeType) {
      warnings.push(`图片 ${relative} 的 MIME 类型未知，按二进制保存`)
    }
    const resolvedMime = mimeType ?? 'application/octet-stream'
    if (!magicMatches(resolvedMime, assetBytes)) {
      throw new BackupError('invalid-data', `图片 ${relative} 的内容与扩展名不符`)
    }
    if (assetBytes.byteLength > limits.maxEntryBytes) {
      throw new BackupError('too-large', `图片 ${relative} 超过大小限制`)
    }
    assets.push({
      id,
      mimeType: resolvedMime,
      size: assetBytes.byteLength,
      sha256: await sha256Hex(assetBytes),
      createdAt: Date.now(),
      bytes: assetBytes,
      blob: new Blob([assetBytes as BlobPart], { type: resolvedMime }),
    })
  }
  if (manifest.assetCount !== assets.length) {
    throw new BackupError('invalid-data', '备份中的图片数量与清单不一致')
  }

  // ---- Referential integrity ----
  const scratchIds = new Set<string>()
  for (const scratch of scratches) {
    if (scratchIds.has(scratch.id)) {
      throw new BackupError('invalid-data', `草稿 ID 重复：${scratch.id}`)
    }
    scratchIds.add(scratch.id)
  }
  const blockIds = new Set<string>()
  const blocksByScratch = new Map<string, ContentBlock[]>()
  for (const block of blocks) {
    if (blockIds.has(block.id)) {
      throw new BackupError('invalid-data', `内容块 ID 重复：${block.id}`)
    }
    if (!scratchIds.has(block.scratchId)) {
      throw new BackupError('invalid-data', `内容块 ${block.id} 指向不存在的草稿`)
    }
    blockIds.add(block.id)
    const list = blocksByScratch.get(block.scratchId) ?? []
    list.push(block)
    blocksByScratch.set(block.scratchId, list)
  }

  const referencedAssets = new Set<string>()
  for (const block of blocks) {
    collectAssetIds(block.content.node, referencedAssets)
  }
  for (const assetId of referencedAssets) {
    if (!assetIds.has(assetId)) {
      warnings.push(`有图片资源缺失（${assetId.slice(0, 8)}…），对应图片将显示为占位符`)
    }
  }

  const seenLayouts = new Set<string>()
  const normalizedPaperLayouts: Dataset['paperLayouts'] = []
  for (const layout of paperLayouts) {
    if (!scratchIds.has(layout.scratchId)) {
      warnings.push('已忽略指向不存在草稿的纸张布局')
      continue
    }
    if (!seenLayouts.has(layout.scratchId)) seenLayouts.add(layout.scratchId)
    const scratchBlockIds = new Set(
      (blocksByScratch.get(layout.scratchId) ?? []).map((block) => block.id),
    )
    const seen = new Set<string>()
    const order = layout.blockOrder.filter((blockId) => {
      const valid = scratchBlockIds.has(blockId) && !seen.has(blockId)
      if (!valid) warnings.push('纸张顺序中存在无效或重复的块引用，已自动修正')
      seen.add(blockId)
      return valid
    })
    for (const block of blocksByScratch.get(layout.scratchId) ?? []) {
      if (!seen.has(block.id)) {
        order.push(block.id)
        warnings.push('有内容块未出现在纸张顺序中，已追加到末尾')
      }
    }
    normalizedPaperLayouts.push({ scratchId: layout.scratchId, blockOrder: order })
  }
  for (const scratchId of scratchIds) {
    if (!seenLayouts.has(scratchId)) {
      normalizedPaperLayouts.push({
        scratchId,
        blockOrder: (blocksByScratch.get(scratchId) ?? [])
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((block) => block.id),
      })
      warnings.push('有草稿缺少纸张顺序，已按创建时间重建')
    }
  }

  const normalizedCanvasLayouts: Dataset['canvasLayouts'] = []
  for (const layout of canvasLayouts) {
    if (!scratchIds.has(layout.scratchId)) {
      warnings.push('已忽略指向不存在草稿的画布布局')
      continue
    }
    const scratchBlockIds = new Set(
      (blocksByScratch.get(layout.scratchId) ?? []).map((block) => block.id),
    )
    const hidden = layout.hiddenBlockIds.filter((blockId) => {
      if (scratchBlockIds.has(blockId)) return true
      warnings.push('画布隐藏列表包含无效引用，已清理')
      return false
    })
    normalizedCanvasLayouts.push({ ...layout, hiddenBlockIds: hidden })
  }

  const dataset: Dataset = {
    scratches,
    blocks,
    paperLayouts: normalizedPaperLayouts,
    canvasLayouts: normalizedCanvasLayouts,
    assets,
  }

  return { dataset, manifest, warnings, encrypted }
}

function requiredFile(files: Record<string, Uint8Array>, name: string): Uint8Array {
  const file = files[name]
  if (!file) throw new BackupError('invalid-format', `备份缺少 ${name}`)
  return file
}

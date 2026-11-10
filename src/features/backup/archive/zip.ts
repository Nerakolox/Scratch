import { unzipSync, zipSync, type Zippable } from 'fflate'
import { BackupError } from '../errors'

export interface ArchiveLimits {
  maxArchiveBytes: number
  maxUncompressedBytes: number
  maxEntryBytes: number
  maxEntries: number
  maxJsonBytes: number
}

const envLimit = Number(import.meta.env.VITE_MAX_BACKUP_BYTES)

export const DEFAULT_LIMITS: ArchiveLimits = {
  maxArchiveBytes:
    Number.isFinite(envLimit) && envLimit > 0 ? envLimit : 256 * 1024 * 1024,
  maxUncompressedBytes: 512 * 1024 * 1024,
  maxEntryBytes: 100 * 1024 * 1024,
  maxEntries: 20_000,
  maxJsonBytes: 64 * 1024 * 1024,
}

export interface ZipEntryInfo {
  name: string
  compressedSize: number
  uncompressedSize: number
}

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true)
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true)
}

/**
 * Parse the ZIP central directory without inflating anything, so archive
 * bombs are rejected before they can allocate unbounded memory.
 */
export function inspectZip(bytes: Uint8Array, limits: ArchiveLimits = DEFAULT_LIMITS): ZipEntryInfo[] {
  if (bytes.byteLength > limits.maxArchiveBytes) {
    throw new BackupError('too-large', '备份文件超过大小限制')
  }
  if (bytes.byteLength < 22) {
    throw new BackupError('invalid-format', '不是有效的 ZIP/备份文件')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  const scanStart = Math.max(0, bytes.byteLength - 0xffff - 22)
  for (let offset = bytes.byteLength - 22; offset >= scanStart; offset -= 1) {
    if (readUint32(view, offset) === 0x06054b50) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) {
    throw new BackupError('invalid-format', '找不到 ZIP 目录，文件可能已损坏')
  }
  const totalEntries = readUint16(view, eocd + 10)
  const directorySize = readUint32(view, eocd + 12)
  const directoryOffset = readUint32(view, eocd + 16)
  if (totalEntries > limits.maxEntries) {
    throw new BackupError('too-large', '备份内文件数量异常')
  }
  if (directoryOffset + directorySize > bytes.byteLength) {
    throw new BackupError('invalid-format', 'ZIP 目录位置非法')
  }

  const entries: ZipEntryInfo[] = []
  let cursor = directoryOffset
  let totalUncompressed = 0
  const seen = new Set<string>()

  for (let index = 0; index < totalEntries; index += 1) {
    if (readUint32(view, cursor) !== 0x02014b50) {
      throw new BackupError('invalid-format', 'ZIP 中央目录损坏')
    }
    const compressedSize = readUint32(view, cursor + 20)
    const uncompressedSize = readUint32(view, cursor + 24)
    const nameLength = readUint16(view, cursor + 28)
    const extraLength = readUint16(view, cursor + 30)
    const commentLength = readUint16(view, cursor + 32)
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new BackupError('too-large', '不支持 ZIP64 格式的超大备份')
    }
    if (uncompressedSize > limits.maxEntryBytes) {
      throw new BackupError('too-large', '备份内单个文件超过大小限制')
    }
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength)
    const name = new TextDecoder().decode(nameBytes)
    if (
      !name ||
      name.startsWith('/') ||
      name.includes('\\') ||
      name.split('/').some((part) => part === '..' || part === '.')
    ) {
      throw new BackupError('invalid-format', '备份内包含非法文件路径')
    }
    if (seen.has(name)) {
      throw new BackupError('invalid-format', '备份内包含重复文件')
    }
    seen.add(name)
    totalUncompressed += uncompressedSize
    if (totalUncompressed > limits.maxUncompressedBytes) {
      throw new BackupError('too-large', '备份解压后体积超过限制，可能是压缩炸弹')
    }
    entries.push({ name, compressedSize, uncompressedSize })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

export function readZipEntries(
  bytes: Uint8Array,
  limits: ArchiveLimits = DEFAULT_LIMITS,
): Record<string, Uint8Array> {
  inspectZip(bytes, limits)
  try {
    return unzipSync(bytes)
  } catch (error) {
    throw new BackupError('invalid-format', '备份文件解压失败，可能已损坏', error)
  }
}

export function buildZip(
  files: Record<string, Uint8Array>,
  compressJson = true,
): Uint8Array {
  const zippable: Zippable = {}
  for (const [name, data] of Object.entries(files)) {
    const isJson = name.endsWith('.json')
    zippable[name] = [data, { level: compressJson && isJson ? 6 : 0 }]
  }
  return zipSync(zippable)
}

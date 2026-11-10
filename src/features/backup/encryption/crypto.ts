import { z } from 'zod'
import { encryptedHeaderSchema } from '@/core/schemas'
import { PBKDF2_ITERATIONS, ENCRYPTED_FORMAT } from '@/shared/constants'
import { BackupError } from '../errors'
import { fromBase64, randomBytes, toBase64, utf8 } from '../archive/hash'

export type EncryptedHeader = z.infer<typeof encryptedHeaderSchema>

const IV_BYTES = 12
const SALT_BYTES = 16

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new BackupError('unknown', '当前环境不支持 Web Crypto，无法加解密备份')
  }
  const baseKey = await crypto.subtle.importKey('raw', utf8(password) as BufferSource, 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptBackup(
  payload: Uint8Array,
  password: string,
): Promise<{ cipher: Uint8Array; header: EncryptedHeader }> {
  if (password.length < 8) {
    throw new BackupError('invalid-data', '加密密码至少需要 8 个字符')
  }
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS)
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, tagLength: 128 },
    key,
    payload as BufferSource,
  )
  const header: EncryptedHeader = {
    format: ENCRYPTED_FORMAT,
    formatVersion: 1,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
  }
  return { cipher: new Uint8Array(cipherBuffer), header }
}

export async function decryptBackup(
  cipher: Uint8Array,
  header: EncryptedHeader,
  password: string,
): Promise<Uint8Array> {
  const salt = fromBase64(header.salt)
  const iv = fromBase64(header.iv)
  if (salt.byteLength < 8 || iv.byteLength !== IV_BYTES) {
    throw new BackupError('invalid-format', '加密备份头参数无效')
  }
  const key = await deriveKey(password, salt, header.iterations)
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, tagLength: 128 },
      key,
      cipher as BufferSource,
    )
    return new Uint8Array(plain)
  } catch (error) {
    throw new BackupError(
      'wrong-password',
      '无法解密备份：密码错误，或文件已被篡改',
      error,
    )
  }
}

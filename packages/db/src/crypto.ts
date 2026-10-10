/**
 * Secret storage for provider API keys and integration credentials.
 *
 * AES-256-GCM with a random 96-bit IV per encryption. The key is derived from
 * APP_SECRET via scrypt so a short human-chosen secret still yields 32 bytes.
 * Stored form is base64; the plaintext is never persisted, logged, or returned
 * to a client.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { AppError, validation } from '@marketing-agent/shared'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
/** Fixed salt: the derivation input is APP_SECRET and the output is internal only. */
const KDF_SALT = Buffer.from('marketing-agent.secret.v1')

export class SecretBox {
  private readonly key: Buffer

  constructor(appSecret: string) {
    if (typeof appSecret !== 'string' || appSecret.length < 16) {
      throw new AppError(
        'needs_configuration',
        'APP_SECRET cần tối thiểu 16 ký tự để mã hoá API key. Hãy đặt biến môi trường APP_SECRET.',
      )
    }
    this.key = scryptSync(appSecret, KDF_SALT, 32)
  }

  /** Encrypt plaintext into a base64 payload and its base64 IV. */
  encrypt(plaintext: string): { enc: string; iv: string } {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv(ALGO, this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return {
      enc: Buffer.concat([ciphertext, tag]).toString('base64'),
      iv: iv.toString('base64'),
    }
  }

  /** Decrypt a stored payload. Throws a configuration error when the key no longer matches. */
  decrypt(enc: string, iv: string): string {
    try {
      const payload = Buffer.from(enc, 'base64')
      if (payload.length <= TAG_BYTES) throw new Error('payload quá ngắn')
      const ciphertext = payload.subarray(0, payload.length - TAG_BYTES)
      const tag = payload.subarray(payload.length - TAG_BYTES)
      const decipher = createDecipheriv(ALGO, this.key, Buffer.from(iv, 'base64'))
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    } catch (cause) {
      throw new AppError(
        'needs_configuration',
        'Không giải mã được bí mật đã lưu. APP_SECRET có thể đã thay đổi — cần nhập lại API key.',
        { cause },
      )
    }
  }

  /** Encrypt a JSON-serializable config object. */
  encryptJson(value: unknown): { enc: string; iv: string } {
    return this.encrypt(JSON.stringify(value ?? null))
  }

  /** Decrypt a JSON config object; returns undefined when nothing is stored. */
  decryptJson<T = Record<string, unknown>>(enc: string | null, iv: string | null): T | undefined {
    if (!enc || !iv) return undefined
    const raw = this.decrypt(enc, iv)
    try {
      return JSON.parse(raw) as T
    } catch (cause) {
      throw new AppError('internal', 'Bí mật đã lưu không phải JSON hợp lệ', { cause })
    }
  }
}

/**
 * A short, non-reversible hint shown in the UI so an operator can tell which key
 * is stored without ever exposing it.
 */
export function keyHint(plaintext: string): string {
  const trimmed = plaintext.trim()
  if (trimmed.length <= 8) return '••••'
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`
}

/** Constant-time string comparison for tokens and hashes. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** Validate an APP_SECRET-shaped value at boot with an actionable message. */
export function assertAppSecret(value: string | undefined): string {
  if (!value || value.length < 16) {
    throw validation(
      'Thiếu APP_SECRET (tối thiểu 16 ký tự). Sao chép .env.example thành .env và đặt APP_SECRET.',
    )
  }
  return value
}

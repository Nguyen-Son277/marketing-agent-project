/**
 * Password hashing (scrypt) and session-token helpers.
 *
 * Password form: `scrypt$N$r$p$<saltB64>$<hashB64>`, self-describing so the cost
 * parameters can be raised later without invalidating existing accounts.
 */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { sha256, unauthorized, validation } from '@marketing-agent/shared'

const N = 16_384
const R = 8
const P = 1
const KEY_LEN = 32
const SALT_LEN = 16

export function hashPassword(password: string): string {
  if (password.length < 10) throw validation('Mật khẩu cần ít nhất 10 ký tự')
  const salt = randomBytes(SALT_LEN)
  const hash = scryptSync(password, salt, KEY_LEN, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  const salt = Buffer.from(parts[4] ?? '', 'base64')
  const expected = Buffer.from(parts[5] ?? '', 'base64')
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false
  const actual = scryptSync(password, salt, expected.length, { N: n, r, p })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export interface SessionTokenValue {
  /** Opaque token handed to the browser; only its hash is stored. */
  readonly token: string
  readonly tokenHash: string
  readonly sessionId: string
  readonly expiresAt: string
}

/** Mint a session token with a 30-day default lifetime. */
export function createSessionToken(ttlDays = 30): SessionTokenValue {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
  return {
    token,
    tokenHash: sha256(token),
    sessionId: `sess_${randomUUID().replaceAll('-', '')}`,
    expiresAt: expires.toISOString(),
  }
}

export const hashToken = (token: string): string => sha256(token)

/** Reject a weak secret early with an actionable message. */
export function assertPasswordStrength(password: string): void {
  if (password.length < 10) throw validation('Mật khẩu cần ít nhất 10 ký tự')
}

export function invalidCredentials(): never {
  throw unauthorized('Email hoặc mật khẩu không đúng')
}

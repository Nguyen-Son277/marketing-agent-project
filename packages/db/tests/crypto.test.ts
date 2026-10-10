import { describe, expect, it } from 'vitest'
import { SecretBox, keyHint, safeEqual } from '../src/crypto.ts'

const SECRET = 'unit-test-app-secret-0123456789'

describe('SecretBox', () => {
  it('round-trips a plaintext value', () => {
    const box = new SecretBox(SECRET)
    const { enc, iv } = box.encrypt('sk-test-abcdef123456')
    expect(enc).not.toContain('sk-test')
    expect(box.decrypt(enc, iv)).toBe('sk-test-abcdef123456')
  })

  it('uses a fresh IV per call so identical plaintexts differ', () => {
    const box = new SecretBox(SECRET)
    const first = box.encrypt('same-value')
    const second = box.encrypt('same-value')
    expect(first.iv).not.toBe(second.iv)
    expect(first.enc).not.toBe(second.enc)
    expect(box.decrypt(first.enc, first.iv)).toBe(box.decrypt(second.enc, second.iv))
  })

  it('round-trips JSON config objects', () => {
    const box = new SecretBox(SECRET)
    const config = { token: 'abc', siteUrl: 'https://example.com', nested: { n: 1 } }
    const stored = box.encryptJson(config)
    expect(box.decryptJson(stored.enc, stored.iv)).toEqual(config)
  })

  it('returns undefined for an absent stored config', () => {
    const box = new SecretBox(SECRET)
    expect(box.decryptJson(null, null)).toBeUndefined()
  })

  it('fails loudly when the secret changed instead of returning garbage', () => {
    const stored = new SecretBox(SECRET).encrypt('top-secret')
    const other = new SecretBox('a-completely-different-secret-value')
    expect(() => other.decrypt(stored.enc, stored.iv)).toThrowError(/APP_SECRET/)
  })

  it('rejects a tampered ciphertext', () => {
    const box = new SecretBox(SECRET)
    const { enc, iv } = box.encrypt('top-secret')
    const buffer = Buffer.from(enc, 'base64')
    buffer[0] = (buffer[0] ?? 0) ^ 0xff
    expect(() => box.decrypt(buffer.toString('base64'), iv)).toThrow()
  })

  it('refuses to construct without a long enough secret', () => {
    expect(() => new SecretBox('short')).toThrowError(/APP_SECRET/)
  })
})

describe('keyHint', () => {
  it('shows only the ends of a long key', () => {
    expect(keyHint('sk-1234567890abcdef')).toBe('sk-1…cdef')
  })

  it('hides entirely for short keys', () => {
    expect(keyHint('abc')).toBe('••••')
  })
})

describe('safeEqual', () => {
  it('compares equal and unequal values', () => {
    expect(safeEqual('token', 'token')).toBe(true)
    expect(safeEqual('token', 'tokeN')).toBe(false)
    expect(safeEqual('token', 'token-longer')).toBe(false)
  })
})

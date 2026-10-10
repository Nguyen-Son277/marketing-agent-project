/**
 * Shared Google API plumbing for the Search Console, Analytics and Sheets tools.
 *
 * All three use an OAuth refresh token, exchanged for a short-lived access token.
 * Tokens are cached in memory **per refresh token** and refreshed slightly before
 * expiry: without the cache every tool call would burn a token exchange, and
 * Google rate-limits those aggressively.
 */
import { toolError, truncate } from '@marketing-agent/shared'
import type { GoogleOAuthConfig } from '../integrations.ts'

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
/** Refresh this many milliseconds before the reported expiry. */
const EXPIRY_SKEW_MS = 60_000

interface CachedToken {
  readonly accessToken: string
  readonly expiresAtMs: number
}

const tokenCache = new Map<string, CachedToken>()

export interface GoogleRequestOptions {
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

/** Exchange a refresh token for an access token, reusing a live cached one. */
export async function getAccessToken(
  config: GoogleOAuthConfig,
  options: GoogleRequestOptions = {},
): Promise<string> {
  const cacheKey = `${config.clientId}:${config.refreshToken.slice(-12)}`
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAtMs > Date.now() + EXPIRY_SKEW_MS) {
    return cached.accessToken
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token',
  })

  const response = await fetchWithTimeout(
    TOKEN_ENDPOINT,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
    options.timeoutMs ?? 15_000,
    options.signal,
  )
  const text = await response.text()
  if (!response.ok) {
    // A revoked or wrong-client refresh token is a configuration problem, and the
    // operator needs to know that specifically.
    throw toolError(
      `Không lấy được access token của Google (HTTP ${response.status}). ` +
        `Refresh token có thể đã hết hiệu lực hoặc sai client. Chi tiết: ${truncate(text, 300)}`,
    )
  }
  let parsed: { access_token?: string; expires_in?: number }
  try {
    parsed = JSON.parse(text) as typeof parsed
  } catch {
    throw toolError('Google trả về dữ liệu token không phải JSON')
  }
  if (!parsed.access_token) {
    throw toolError('Google không trả access_token. Kiểm tra lại client id/secret và refresh token.')
  }

  const ttlMs = (parsed.expires_in ?? 3_600) * 1_000
  tokenCache.set(cacheKey, {
    accessToken: parsed.access_token,
    expiresAtMs: Date.now() + ttlMs,
  })
  return parsed.access_token
}

/** Clear the cached token for a config; used by the settings "test connection" action. */
export function invalidateAccessToken(config: GoogleOAuthConfig): void {
  tokenCache.delete(`${config.clientId}:${config.refreshToken.slice(-12)}`)
}

/** Authenticated JSON request against a Google API. */
export async function googleJson<T = Record<string, unknown>>(
  config: GoogleOAuthConfig,
  url: string,
  options: GoogleRequestOptions & { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = await getAccessToken(config, options)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }
  if (config.quotaProjectId) headers['x-goog-user-project'] = config.quotaProjectId
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetchWithTimeout(
    url,
    {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    options.timeoutMs ?? 30_000,
    options.signal,
  )
  const text = await response.text()
  if (!response.ok) {
    throw toolError(`Google API trả lỗi HTTP ${response.status}: ${truncate(text, 400)}`)
  }
  if (text.trim().length === 0) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw toolError('Google API trả về dữ liệu không phải JSON')
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Hết thời gian chờ')), timeoutMs)
  const onAbort = () => controller.abort(externalSignal?.reason)
  externalSignal?.addEventListener('abort', onAbort, { once: true })
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Format a GA4/GSC date range. Google expects `YYYY-MM-DD`, and a bare number of
 * days means "the last N days", which is the common case for a marketing agent.
 */
export function resolveDateRange(input: {
  startDate?: string
  endDate?: string
  days?: number
}): { startDate: string; endDate: string } {
  if (input.startDate && input.endDate) {
    assertIsoDate(input.startDate, 'startDate')
    assertIsoDate(input.endDate, 'endDate')
    return { startDate: input.startDate, endDate: input.endDate }
  }
  const days = Math.min(365, Math.max(1, input.days ?? 28))
  const end = new Date()
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000)
  return { startDate: toIsoDate(start), endDate: toIsoDate(end) }
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function assertIsoDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw toolError(`${field} phải theo định dạng YYYY-MM-DD, nhận được "${value}"`)
  }
}

/** `properties/123456789` or a bare id both become a full GA4 resource name. */
export function normalizeGa4Property(propertyId: string): string {
  const trimmed = propertyId.trim()
  return trimmed.startsWith('properties/') ? trimmed : `properties/${trimmed}`
}

/** A GSC site can be a domain property (`sc-domain:`) or a URL prefix. */
export function normalizeSearchConsoleSite(siteUrl: string): string {
  const trimmed = siteUrl.trim()
  if (trimmed.startsWith('sc-domain:')) return trimmed
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

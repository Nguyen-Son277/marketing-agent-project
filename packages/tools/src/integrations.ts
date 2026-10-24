/**
 * Integration credential access.
 *
 * Integrations are configured per company and stored encrypted. This module is
 * the one place that turns a stored row into a usable config, and it fails with
 * `needs_configuration` — not a generic error — so an agent can tell the user
 * "hãy kết nối Google Search Console" instead of inventing numbers.
 */
import { needsConfiguration, type IntegrationKind, type IntegrationRecord, type ToolContext } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'

export interface GoogleOAuthConfig {
  readonly clientId: string
  readonly clientSecret: string
  readonly refreshToken: string
  /** Optional: some Google APIs need a quota project header. */
  readonly quotaProjectId?: string
  /** Default Search Console property, so the agent need not repeat it each call. */
  readonly siteUrl?: string
  /** Default GA4 property id, so the agent need not repeat it each call. */
  readonly propertyId?: string
  /** Google Ads only: developer token issued by the Google Ads API centre. */
  readonly developerToken?: string
  /** Google Ads only: the customer id the queries run against. */
  readonly customerId?: string
}

export interface FirecrawlConfig {
  readonly apiKey: string
  readonly baseUrl?: string
}

export interface MetaConfig {
  readonly accessToken: string
  readonly refreshToken?: string
  readonly clientId?: string
  readonly clientSecret?: string
  readonly expiresAt?: string
  readonly pageId?: string
  /** Instagram business account related to the selected Facebook Page. */
  readonly instagramAccountId?: string
  readonly adAccountId?: string
  readonly apiVersion?: string
}

export interface LinkedInConfig {
  readonly accessToken: string
  readonly refreshToken?: string
  readonly clientId?: string
  readonly clientSecret?: string
  readonly expiresAt?: string
  readonly organizationUrn?: string
  readonly apiVersion?: string
}

export interface SmtpConfig {
  readonly host: string
  readonly port: number
  readonly user: string
  readonly password: string
  readonly from: string
}

export type IntegrationConfigMap = {
  firecrawl: FirecrawlConfig
  'google-search-console': GoogleOAuthConfig
  'google-analytics': GoogleOAuthConfig
  'google-sheets': GoogleOAuthConfig
  'google-ads': GoogleOAuthConfig
  meta: MetaConfig
  linkedin: LinkedInConfig
  'email-smtp': SmtpConfig
}

/** Result of a connectivity check, surfaced by the settings screen. */
export interface IntegrationStatus {
  readonly kind: IntegrationKind
  readonly name: string
  readonly configured: boolean
  readonly status: string
  readonly lastCheckAt: string | null
}

export class IntegrationStore {
  constructor(private readonly repos: Repos) {}

  list(companyId: string): IntegrationStatus[] {
    return this.repos.accounting.listIntegrations(companyId).map((row) => ({
      kind: row.kind,
      name: row.name,
      configured: Boolean(row.configEnc),
      status: row.status,
      lastCheckAt: row.lastCheckAt,
    }))
  }

  find(companyId: string, kind: IntegrationKind, name?: string): IntegrationRecord | undefined {
    return this.repos.accounting.findIntegration(companyId, kind, name)
  }

  /**
   * Resolve a config for a tool call, or throw a message the agent can act on.
   * The error names the missing integration so the user knows what to connect.
   *
   * `K` is constrained to the keys of the config map, not to `IntegrationKind`,
   * so the return type is the concrete config for that kind rather than a union.
   */
  require<K extends keyof IntegrationConfigMap>(
    companyId: string,
    kind: K,
    displayName: string,
  ): IntegrationConfigMap[K] {
    const row = this.repos.accounting.findIntegration(companyId, kind)
    if (!row || !row.configEnc) {
      throw needsConfiguration(
        `Chưa kết nối ${displayName}. Vào Cài đặt → Kết nối để thêm, sau đó thử lại.`,
        { kind },
      )
    }
    const config = this.repos.accounting.resolveIntegrationConfig<IntegrationConfigMap[K]>(row)
    if (!config) {
      throw needsConfiguration(`Cấu hình ${displayName} trống hoặc không đọc được. Hãy nhập lại trong Cài đặt.`, {
        kind,
      })
    }
    return config
  }

  /** Resolve without throwing; used when a tool can degrade gracefully. */
  optional<K extends keyof IntegrationConfigMap>(companyId: string, kind: K): IntegrationConfigMap[K] | undefined {
    const row = this.repos.accounting.findIntegration(companyId, kind)
    if (!row?.configEnc) return undefined
    try {
      return this.repos.accounting.resolveIntegrationConfig<IntegrationConfigMap[K]>(row)
    } catch {
      return undefined
    }
  }

  /** Resolve OAuth credentials and refresh expiring Meta/LinkedIn tokens before use. */
  async requireFresh<K extends 'meta' | 'linkedin'>(companyId: string, kind: K, displayName: string): Promise<IntegrationConfigMap[K]> {
    const row = this.repos.accounting.findIntegration(companyId, kind)
    if (!row || !row.configEnc) throw needsConfiguration(`Chưa kết nối ${displayName}. Vào Cài đặt → Kết nối để thêm, sau đó thử lại.`, { kind })
    const config = this.repos.accounting.resolveIntegrationConfig<IntegrationConfigMap[K]>(row)
    if (!config) throw needsConfiguration(`Cấu hình ${displayName} trống hoặc không đọc được. Hãy kết nối lại trong Cài đặt.`, { kind })
    const expiresAt = 'expiresAt' in config && typeof config.expiresAt === 'string' ? Date.parse(config.expiresAt) : NaN
    if (!Number.isFinite(expiresAt) || expiresAt > Date.now() + 60_000) return config
    try {
      const refreshed = await refreshOAuthToken(kind, config as MetaConfig | LinkedInConfig)
      const next = { ...config, ...refreshed }
      this.repos.accounting.updateIntegrationConfig(companyId, row.id, refreshed)
      this.repos.accounting.markIntegrationChecked(row.id, companyId, 'connected')
      return next
    } catch (error) {
      this.repos.accounting.markIntegrationChecked(row.id, companyId, 'token_expired')
      throw needsConfiguration(`${displayName} cần kết nối lại vì token đã hết hạn.`, { kind })
    }
  }

  markChecked(companyId: string, kind: keyof IntegrationConfigMap, status: string): void {
    const row = this.repos.accounting.findIntegration(companyId, kind)
    if (row) this.repos.accounting.markIntegrationChecked(row.id, companyId, status)
  }
}

async function refreshOAuthToken(kind: 'meta' | 'linkedin', config: MetaConfig | LinkedInConfig): Promise<Record<string, string>> {
  if (kind === 'linkedin') {
    if (!config.refreshToken || !config.clientId || !config.clientSecret) throw new Error('missing refresh credentials')
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: config.refreshToken, client_id: config.clientId, client_secret: config.clientSecret })
    const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
    const data = await response.json() as Record<string, unknown>
    if (!response.ok || typeof data.access_token !== 'string') throw new Error('LinkedIn refresh failed')
    return { accessToken: data.access_token, ...(typeof data.refresh_token === 'string' ? { refreshToken: data.refresh_token } : {}), ...(typeof data.expires_in === 'number' ? { expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString() } : {}) }
  }
  if (!config.clientId || !config.clientSecret) throw new Error('missing refresh credentials')
  const url = new URL('https://graph.facebook.com/v21.0/oauth/access_token')
  url.searchParams.set('grant_type', 'fb_exchange_token')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('client_secret', config.clientSecret)
  url.searchParams.set('fb_exchange_token', config.accessToken)
  const response = await fetch(url)
  const data = await response.json() as Record<string, unknown>
  if (!response.ok || typeof data.access_token !== 'string') throw new Error('Meta refresh failed')
  return { accessToken: data.access_token, ...(typeof data.expires_in === 'number' ? { expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString() } : {}) }
}

/** Convenience for tools that only need the store built from a run context. */
export function integrationStoreFrom(): (repos: Repos) => IntegrationStore {
  return (repos: Repos) => new IntegrationStore(repos)
}

export function requirePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

/** Default API versions, pinned so an upstream release cannot change behaviour silently. */
export const API_VERSIONS = {
  meta: 'v21.0',
  linkedin: '202411',
  firecrawl: 'v1',
} as const

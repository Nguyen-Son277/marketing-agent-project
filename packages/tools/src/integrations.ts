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
  readonly pageId?: string
  readonly adAccountId?: string
  readonly apiVersion?: string
}

export interface LinkedInConfig {
  readonly accessToken: string
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

  markChecked(companyId: string, kind: keyof IntegrationConfigMap, status: string): void {
    const row = this.repos.accounting.findIntegration(companyId, kind)
    if (row) this.repos.accounting.markIntegrationChecked(row.id, companyId, status)
  }
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

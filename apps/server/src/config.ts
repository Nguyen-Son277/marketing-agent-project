/**
 * Server configuration, resolved from the environment once at boot.
 *
 * Everything here is deliberately explicit: a missing or unsafe value fails at
 * startup with an actionable message instead of surfacing as a 500 later.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AppError, emailSchema } from '@marketing-agent/shared'

export interface ServerConfig {
  readonly host: string
  readonly port: number
  readonly appSecret: string
  /** Existing account promoted after a successful login; unset disables promotion. */
  readonly adminEmail?: string
  readonly databasePath: string
  /** Absolute directory holding per-company knowledge bases. */
  readonly companiesRoot: string
  /**
   * Root of the per-company KNOWLEDGE BASE, one directory per company slug
   * (`<kbRoot>/<slug>/kb`).
   *
   * Separate from `companiesRoot` on purpose: the KB is curated Markdown owned by
   * people and read by `pnpm kb:index`, while `companiesRoot` holds files agents
   * produce. Defaults to `data/companies` so it matches what the kb CLI uses.
   */
  readonly kbRoot: string
  /** Built SPA directory to serve in production; undefined disables static serving. */
  readonly webDist: string | undefined
  /** Days a login session stays valid. */
  readonly sessionTtlDays: number
  readonly isProduction: boolean
  /** Max JSON request body size, guarding against accidental large uploads. */
  readonly maxBodyBytes: number
  readonly embedding: EmbeddingConfig
  /** Public URL used as OAuth callback origin (e.g. https://marketing.example). */
  readonly publicBaseUrl?: string
  readonly oauthCallbackBaseUrl?: string
}

export interface EmbeddingConfig {
  readonly provider: 'local' | 'remote' | 'hash'
  readonly model: string
  readonly baseUrl: string | undefined
  readonly apiKey: string | undefined
}

/** Minimal .env reader: `KEY=value`, `#` comments, optional surrounding quotes. */
export function loadDotEnv(file = '.env'): void {
  const path = resolve(file)
  if (!existsSync(path)) return
  const text = readFileSync(path, 'utf8')
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    // Real environment variables always win over the file.
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function requireString(key: string, minLength = 1): string {
  const value = process.env[key]
  if (!value || value.trim().length < minLength) {
    throw new AppError(
      'needs_configuration',
      `Thiếu biến môi trường ${key}${minLength > 1 ? ` (cần tối thiểu ${minLength} ký tự)` : ''}. ` +
        'Sao chép .env.example thành .env và điền giá trị.',
    )
  }
  return value.trim()
}

function optionalString(key: string): string | undefined {
  const value = process.env[key]
  return value && value.trim().length > 0 ? value.trim() : undefined
}

function configuredAdminEmail(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined
  const parsed = emailSchema.safeParse(value)
  if (!parsed.success) {
    throw new AppError('needs_configuration', 'ADMIN_EMAIL phải là một địa chỉ email hợp lệ.')
  }
  return parsed.data
}

function numberFromEnv(key: string, fallback: number, range: { min: number; max: number }): number {
  const raw = process.env[key]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < range.min || parsed > range.max) {
    throw new AppError(
      'needs_configuration',
      `${key} phải là số trong khoảng ${range.min}–${range.max}, nhận được "${raw}".`,
    )
  }
  return parsed
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const production = (process.env.NODE_ENV ?? 'development') === 'production'
  const embeddingProvider = (optionalString('EMBEDDING_PROVIDER') ?? 'local') as EmbeddingConfig['provider']
  if (!['local', 'remote', 'hash'].includes(embeddingProvider)) {
    throw new AppError(
      'needs_configuration',
      `EMBEDDING_PROVIDER phải là local, remote hoặc hash — nhận được "${embeddingProvider}".`,
    )
  }

  return {
    host: overrides.host ?? optionalString('HOST') ?? '127.0.0.1',
    port: overrides.port ?? numberFromEnv('PORT', 3000, { min: 0, max: 65_535 }),
    appSecret: overrides.appSecret ?? requireString('APP_SECRET', 16),
    adminEmail: configuredAdminEmail(overrides.adminEmail ?? optionalString('ADMIN_EMAIL')),
    databasePath: overrides.databasePath ?? optionalString('DATABASE_PATH') ?? 'data/marketing.db',
    companiesRoot: overrides.companiesRoot ?? resolve(optionalString('COMPANIES_ROOT') ?? 'data/company-files'),
    kbRoot: overrides.kbRoot ?? resolve(optionalString('KB_ROOT') ?? 'data/companies'),
    webDist: overrides.webDist ?? resolveWebDist(),
    sessionTtlDays: overrides.sessionTtlDays ?? numberFromEnv('SESSION_TTL_DAYS', 30, { min: 1, max: 365 }),
    isProduction: overrides.isProduction ?? production,
    maxBodyBytes: overrides.maxBodyBytes ?? numberFromEnv('MAX_BODY_BYTES', 2_000_000, { min: 1_024, max: 50_000_000 }),
    embedding: overrides.embedding ?? {
      provider: embeddingProvider,
      model: optionalString('EMBEDDING_MODEL') ?? 'Xenova/multilingual-e5-small',
      baseUrl: optionalString('EMBEDDING_BASE_URL'),
      apiKey: optionalString('EMBEDDING_API_KEY'),
    },
    publicBaseUrl: overrides.publicBaseUrl ?? optionalString('PUBLIC_BASE_URL'),
    oauthCallbackBaseUrl: overrides.oauthCallbackBaseUrl ?? optionalString('OAUTH_CALLBACK_BASE_URL'),
  }
}

/** Serve the built SPA when it exists; development uses the Vite dev server instead. */
function resolveWebDist(): string | undefined {
  const explicit = optionalString('WEB_DIST')
  const candidates = [explicit, resolve('apps/web/dist')].filter((p): p is string => Boolean(p))
  for (const candidate of candidates) {
    if (existsSync(candidate)) return resolve(candidate)
  }
  return undefined
}

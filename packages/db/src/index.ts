/**
 * Database package entry point.
 *
 * `createRepos` wires the repository objects over one connection and one secret
 * box; every server and CLI path should construct exactly one of these per
 * process so SQLite keeps its single-writer guarantee.
 */
import { SecretBox, assertAppSecret } from './crypto.ts'
import { openDatabase, type Database, type OpenDatabaseOptions } from './database.ts'
import { AccountingRepo } from './repos/accounting.ts'
import { NotificationsRepo } from './repos/notifications.ts'
import { ChatAttachmentsRepo } from './repos/chat-attachments.ts'
import { AuthRepo } from './repos/auth.ts'
import { KnowledgeRepo } from './repos/knowledge.ts'
import { LlmRepo } from './repos/llm.ts'
import { TeamRepo } from './repos/team.ts'
import { WorkRepo } from './repos/work.ts'
import { WorkforceRepo } from './repos/workforce.ts'
import { DailyReportsRepo } from './repos/daily-reports.ts'
import { SocialBrowserRepo } from './repos/social-browser.ts'
import { CampaignRepo } from './repos/campaign.ts'
import { OAuthRepo } from './repos/oauth.ts'
import { McpRepo } from './repos/mcp.ts'

export interface Repos {
  readonly db: Database
  readonly secrets: SecretBox
  readonly auth: AuthRepo
  readonly llm: LlmRepo
  readonly team: TeamRepo
  readonly knowledge: KnowledgeRepo
  readonly work: WorkRepo
  readonly accounting: AccountingRepo
  readonly workforce: WorkforceRepo
  readonly dailyReports: DailyReportsRepo
  readonly notifications: NotificationsRepo
  readonly chatAttachments: ChatAttachmentsRepo
  readonly socialBrowser: SocialBrowserRepo
  readonly campaigns: CampaignRepo
  readonly oauth: OAuthRepo
  readonly mcp: McpRepo
}

export interface CreateReposOptions extends OpenDatabaseOptions {
  /** Defaults to a module-level override or `process.env.DSH_MARKETING_TEMP_SECRET` in tests. */
  readonly appSecret?: string
  /** Test-only escape hatch: skips the APP_SECRET length check. Never set in production. */
  readonly allowWeakSecret?: boolean
}

/** Resolve the encryption secret, rejecting a missing or too-short value loudly. */
export function resolveAppSecret(explicit?: string): string {
  const value = explicit ?? process.env.APP_SECRET
  return assertAppSecret(value)
}

export function createRepos(options: CreateReposOptions): Repos {
  const secret = options.allowWeakSecret
    ? (options.appSecret ?? process.env.APP_SECRET ?? 'test-secret-not-for-production-use')
    : resolveAppSecret(options.appSecret)

  const db = openDatabase({ file: options.file, verbose: options.verbose })
  const secrets = new SecretBox(secret)
  const llm = new LlmRepo(db, secrets)
  const team = new TeamRepo(db, llm)
  const auth = new AuthRepo(db)
  return {
    db,
    secrets,
    auth,
    workforce: new WorkforceRepo(db, auth),
    dailyReports: new DailyReportsRepo(db, secrets),
    llm,
    team,
    knowledge: new KnowledgeRepo(db),
    work: new WorkRepo(db),
    accounting: new AccountingRepo(db, secrets),
    notifications: new NotificationsRepo(db),
    chatAttachments: new ChatAttachmentsRepo(db),
    socialBrowser: new SocialBrowserRepo(db, secrets),
    campaigns: new CampaignRepo(db, auth, secrets),
    oauth: new OAuthRepo(db, secrets),
    mcp: new McpRepo(db, secrets),
  }
}

export * from './crypto.ts'
export * from './database.ts'
export * from './migrations.ts'
export * from './password.ts'
export * from './vector.ts'
export * from './repos/accounting.ts'
export * from './repos/notifications.ts'
export * from './repos/chat-attachments.ts'
export * from './repos/social-browser.ts'
export * from './repos/auth.ts'
export * from './repos/knowledge.ts'
export type { ClassificationJobRecord, KbSectionRecord } from '@marketing-agent/shared'
export * from './repos/llm.ts'
export * from './repos/team.ts'
export * from './repos/work.ts'
export * from './repos/campaign.ts'
export * from './repos/oauth.ts'
export * from './repos/mcp.ts'

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
import { AuthRepo } from './repos/auth.ts'
import { KnowledgeRepo } from './repos/knowledge.ts'
import { LlmRepo } from './repos/llm.ts'
import { TeamRepo } from './repos/team.ts'
import { WorkRepo } from './repos/work.ts'

export interface Repos {
  readonly db: Database
  readonly secrets: SecretBox
  readonly auth: AuthRepo
  readonly llm: LlmRepo
  readonly team: TeamRepo
  readonly knowledge: KnowledgeRepo
  readonly work: WorkRepo
  readonly accounting: AccountingRepo
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
  return {
    db,
    secrets,
    auth: new AuthRepo(db),
    llm,
    team,
    knowledge: new KnowledgeRepo(db),
    work: new WorkRepo(db),
    accounting: new AccountingRepo(db, secrets),
  }
}

export * from './crypto.ts'
export * from './database.ts'
export * from './migrations.ts'
export * from './password.ts'
export * from './vector.ts'
export * from './repos/accounting.ts'
export * from './repos/auth.ts'
export * from './repos/knowledge.ts'
export * from './repos/llm.ts'
export * from './repos/team.ts'
export * from './repos/work.ts'

import { createHash } from 'node:crypto'
import { newId, nowIso } from '@marketing-agent/shared'
import type { Database } from '../database.ts'
import type { SecretBox } from '../crypto.ts'

export type OAuthProvider = 'google' | 'meta' | 'linkedin'

export interface OAuthAppRecord {
  readonly id: string
  readonly companyId: string
  readonly provider: OAuthProvider
  readonly name: string | null
  readonly clientIdEnc: string
  readonly clientIdIv: string
  readonly clientSecretEnc: string
  readonly clientSecretIv: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface OAuthStateRecord {
  readonly stateHash: string
  readonly companyId: string
  readonly userId: string
  readonly provider: OAuthProvider
  readonly redirectUri: string
  readonly codeVerifierEnc: string | null
  readonly codeVerifierIv: string | null
  readonly expiresAt: string
  readonly createdAt: string
}

export interface OAuthResourceRecord {
  readonly id: string
  readonly integrationId: string
  readonly resourceType: string
  readonly resourceId: string
  readonly label: string
  readonly metadata: Record<string, unknown> | null
  readonly selected: boolean
  readonly createdAt: string
}

interface OAuthAppRow { id: string; company_id: string; provider: OAuthProvider; name: string | null; client_id_enc: string; client_id_iv: string; client_secret_enc: string; client_secret_iv: string; created_at: string; updated_at: string }
interface OAuthStateRow { state_hash: string; company_id: string; user_id: string; provider: OAuthProvider; redirect_uri: string; code_verifier_enc: string | null; code_verifier_iv: string | null; expires_at: string; created_at: string }
interface OAuthResourceRow { id: string; integration_id: string; resource_type: string; resource_id: string; label: string; metadata_json: string | null; selected: number; created_at: string }

const appView = (r: OAuthAppRow): OAuthAppRecord => ({ id: r.id, companyId: r.company_id, provider: r.provider, name: r.name, clientIdEnc: r.client_id_enc, clientIdIv: r.client_id_iv, clientSecretEnc: r.client_secret_enc, clientSecretIv: r.client_secret_iv, createdAt: r.created_at, updatedAt: r.updated_at })
const stateView = (r: OAuthStateRow): OAuthStateRecord => ({ stateHash: r.state_hash, companyId: r.company_id, userId: r.user_id, provider: r.provider, redirectUri: r.redirect_uri, codeVerifierEnc: r.code_verifier_enc, codeVerifierIv: r.code_verifier_iv, expiresAt: r.expires_at, createdAt: r.created_at })

export function hashOAuthState(value: string): string { return createHash('sha256').update(value).digest('hex') }

export class OAuthRepo {
  constructor(private readonly db: Database, private readonly secrets: SecretBox) {}

  upsertApp(input: { companyId: string; provider: OAuthProvider; clientId: string; clientSecret: string; name?: string | null }): OAuthAppRecord {
    const clientId = this.secrets.encrypt(input.clientId)
    const clientSecret = this.secrets.encrypt(input.clientSecret)
    const now = nowIso()
    const existing = this.db.get<OAuthAppRow>('SELECT * FROM oauth_apps WHERE company_id = ? AND provider = ?', [input.companyId, input.provider])
    if (existing) {
      this.db.run('UPDATE oauth_apps SET name = ?, client_id_enc = ?, client_id_iv = ?, client_secret_enc = ?, client_secret_iv = ?, updated_at = ? WHERE id = ?', [input.name ?? null, clientId.enc, clientId.iv, clientSecret.enc, clientSecret.iv, now, existing.id])
      return this.getApp(existing.id)!
    }
    const id = newId()
    this.db.run('INSERT INTO oauth_apps (id, company_id, provider, name, client_id_enc, client_id_iv, client_secret_enc, client_secret_iv, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, input.companyId, input.provider, input.name ?? null, clientId.enc, clientId.iv, clientSecret.enc, clientSecret.iv, now, now])
    return this.getApp(id)!
  }

  getApp(id: string): OAuthAppRecord | undefined { const row = this.db.get<OAuthAppRow>('SELECT * FROM oauth_apps WHERE id = ?', [id]); return row ? appView(row) : undefined }
  findApp(companyId: string, provider: OAuthProvider): OAuthAppRecord | undefined { const row = this.db.get<OAuthAppRow>('SELECT * FROM oauth_apps WHERE company_id = ? AND provider = ?', [companyId, provider]); return row ? appView(row) : undefined }
  resolveApp(app: OAuthAppRecord): { clientId: string; clientSecret: string } { return { clientId: this.secrets.decrypt(app.clientIdEnc, app.clientIdIv), clientSecret: this.secrets.decrypt(app.clientSecretEnc, app.clientSecretIv) } }

  createState(input: { state: string; companyId: string; userId: string; provider: OAuthProvider; redirectUri: string; codeVerifier?: string; expiresAt: string }): OAuthStateRecord {
    const verifier = input.codeVerifier ? this.secrets.encrypt(input.codeVerifier) : undefined
    const now = nowIso()
    this.purgeStates()
    this.db.run('INSERT INTO oauth_states (state_hash, company_id, user_id, provider, redirect_uri, code_verifier_enc, code_verifier_iv, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [hashOAuthState(input.state), input.companyId, input.userId, input.provider, input.redirectUri, verifier?.enc ?? null, verifier?.iv ?? null, input.expiresAt, now])
    return this.getState(input.state)!
  }
  getState(state: string): OAuthStateRecord | undefined { const row = this.db.get<OAuthStateRow>('SELECT * FROM oauth_states WHERE state_hash = ?', [hashOAuthState(state)]); return row ? stateView(row) : undefined }
  consumeState(state: string): OAuthStateRecord | undefined { const record = this.getState(state); if (record) this.db.run('DELETE FROM oauth_states WHERE state_hash = ?', [record.stateHash]); return record }
  resolveCodeVerifier(state: OAuthStateRecord): string | undefined { return state.codeVerifierEnc && state.codeVerifierIv ? this.secrets.decrypt(state.codeVerifierEnc, state.codeVerifierIv) : undefined }
  purgeStates(): void { this.db.run('DELETE FROM oauth_states WHERE expires_at <= ?', [nowIso()]) }

  replaceResources(integrationId: string, resources: readonly { resourceType: string; resourceId: string; label: string; metadata?: Record<string, unknown> | null; selected?: boolean }[]): void {
    this.db.tx(() => {
      this.db.run('DELETE FROM integration_oauth_resources WHERE integration_id = ?', [integrationId])
      for (const resource of resources) {
        this.db.run(
          'INSERT INTO integration_oauth_resources (id, integration_id, resource_type, resource_id, label, metadata_json, selected, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [newId(), integrationId, resource.resourceType, resource.resourceId, resource.label, resource.metadata ? JSON.stringify(resource.metadata) : null, resource.selected === false ? 0 : 1, nowIso()],
        )
      }
    })
  }

  listResources(integrationId: string): OAuthResourceRecord[] {
    return this.db.all<OAuthResourceRow>('SELECT * FROM integration_oauth_resources WHERE integration_id = ? ORDER BY label ASC', [integrationId]).map((row) => ({
      id: row.id,
      integrationId: row.integration_id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      label: row.label,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) as Record<string, unknown> : null,
      selected: row.selected === 1,
      createdAt: row.created_at,
    }))
  }
}

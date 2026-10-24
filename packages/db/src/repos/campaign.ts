import {
  conflict,
  newId,
  notFound,
  nowIso,
  sha256,
  type AgencyMembershipRecord,
  type AgencyRecord,
  type AgencyRole,
  type AudienceContactRecord,
  type AudienceRecord,
  type AutomationPolicyRecord,
  type CampaignChannel,
  type CampaignItemRecord,
  type CampaignItemStatus,
  type CampaignRecord,
  type CampaignStatus,
  type CompanyRole,
  type ConsentEventKind,
  type ConsentStatus,
  type ExecutionAttemptRecord,
  type ExecutionJobRecord,
  type ExecutionJobStatus,
  type MetricSnapshotRecord,
} from '@marketing-agent/shared'
import { SecretBox } from '../crypto.ts'
import type { Database } from '../database.ts'
import type { AuthRepo } from './auth.ts'

export interface AgencyClientSummary {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly role: CompanyRole | null
  readonly campaignCount: number
  readonly activeCampaigns: number
  readonly queuedJobs: number
}

export interface CampaignWithItems extends CampaignRecord {
  readonly items: CampaignItemRecord[]
}

export interface LeasedJob extends ExecutionJobRecord {
  readonly item: CampaignItemRecord
}

export interface ContactImportResult {
  readonly inserted: number
  readonly updated: number
  readonly skippedUnsubscribed: number
}

const AGENCY_WRITE_ROLES: readonly AgencyRole[] = ['owner', 'admin', 'operator']

export class CampaignRepo {
  constructor(
    private readonly db: Database,
    private readonly auth: AuthRepo,
    private readonly secrets: SecretBox,
  ) {}

  /* --------------------------------------------------------------- agency */

  createAgency(userId: string, name: string, slug: string): AgencyRecord {
    const id = `agy_${newId().replaceAll('-', '').slice(0, 24)}`
    const createdAt = nowIso()
    this.db.tx(() => {
      this.db.run('INSERT INTO agencies (id,name,slug,created_at) VALUES (?,?,?,?)', [id, name, slug, createdAt])
      this.db.run('INSERT INTO agency_memberships (agency_id,user_id,role,created_at) VALUES (?,?,?,?)', [id, userId, 'owner', createdAt])
    })
    return this.requireAgency(id)
  }

  requireAgency(id: string): AgencyRecord {
    const row = this.db.get<AgencyRow>('SELECT id,name,slug,created_at AS createdAt FROM agencies WHERE id=?', [id])
    if (!row) throw notFound('Không tìm thấy agency')
    return row
  }

  findAgency(id: string): AgencyRecord | undefined {
    return this.db.get<AgencyRow>('SELECT id,name,slug,created_at AS createdAt FROM agencies WHERE id=?', [id])
  }

  listAgenciesForUser(userId: string): Array<AgencyRecord & { role: AgencyRole }> {
    return this.db.all<AgencyRow & { role: AgencyRole }>(
      `SELECT a.id,a.name,a.slug,a.created_at AS createdAt,m.role
       FROM agencies a JOIN agency_memberships m ON m.agency_id=a.id
       WHERE m.user_id=? ORDER BY a.name,a.id`,
      [userId],
    )
  }

  agencyMembership(agencyId: string, userId: string): AgencyMembershipRecord | undefined {
    const row = this.db.get<AgencyMembershipRow>(
      `SELECT agency_id AS agencyId,user_id AS userId,role,created_at AS createdAt
       FROM agency_memberships WHERE agency_id=? AND user_id=?`,
      [agencyId, userId],
    )
    return row ? { ...row, role: row.role as AgencyRole } : undefined
  }

  addAgencyMembership(agencyId: string, userId: string, role: AgencyRole): AgencyMembershipRecord {
    if (!this.findAgency(agencyId)) throw notFound('Không tìm thấy agency')
    if (!this.auth.findUserById(userId)) throw notFound('Không tìm thấy người dùng')
    const at = nowIso()
    this.db.run(
      `INSERT INTO agency_memberships(agency_id,user_id,role,created_at) VALUES(?,?,?,?)
       ON CONFLICT(agency_id,user_id) DO UPDATE SET role=excluded.role`,
      [agencyId, userId, role, at],
    )
    return this.agencyMembership(agencyId, userId)!
  }

  listAgencyMembers(agencyId: string, userId: string): Array<AgencyMembershipRecord & { name: string; email: string }> {
    this.requireAgencyMembership(agencyId, userId)
    return this.db.all<AgencyMembershipRow & { name: string; email: string }>(
      `SELECT m.agency_id AS agencyId,m.user_id AS userId,m.role,m.created_at AS createdAt,u.name,u.email
       FROM agency_memberships m JOIN users u ON u.id=m.user_id WHERE m.agency_id=? ORDER BY u.name,u.email`,
      [agencyId],
    ).map((row) => ({ ...row, role: row.role as AgencyRole }))
  }

  requireAgencyMembership(agencyId: string, userId: string, write = false): AgencyMembershipRecord {
    const membership = this.agencyMembership(agencyId, userId)
    if (!membership || (write && !AGENCY_WRITE_ROLES.includes(membership.role))) {
      throw notFound('Không tìm thấy agency trong phạm vi của bạn')
    }
    return membership
  }

  linkCompany(agencyId: string, companyId: string): void {
    if (!this.findAgency(agencyId)) throw notFound('Không tìm thấy agency')
    if (!this.auth.findCompanyById(companyId)) throw notFound('Không tìm thấy client workspace')
    this.db.tx(() => {
      this.db.run('DELETE FROM agency_clients WHERE company_id=?', [companyId])
      this.db.run('INSERT INTO agency_clients(agency_id,company_id,created_at) VALUES(?,?,?)', [agencyId, companyId, nowIso()])
    })
  }

  agencyForCompany(companyId: string): string | null {
    return this.db.get<{ agencyId: string | null }>('SELECT agency_id AS agencyId FROM agency_clients WHERE company_id=? LIMIT 1', [companyId])?.agencyId ?? null
  }

  /** Direct membership or agency membership; used by CampaignLoop routes only. */
  companyAccess(userId: string, companyId: string): { companyRole: CompanyRole | null; agencyRole: AgencyRole | null } {
    const direct = this.auth.membership(companyId, userId)
    if (direct) return { companyRole: direct.role, agencyRole: null }
    const agencyId = this.agencyForCompany(companyId)
    if (!agencyId) return { companyRole: null, agencyRole: null }
    const agency = this.agencyMembership(agencyId, userId)
    return { companyRole: null, agencyRole: agency?.role ?? null }
  }

  canReadCompany(userId: string, companyId: string): boolean {
    const access = this.companyAccess(userId, companyId)
    return Boolean(access.companyRole || access.agencyRole)
  }

  canWriteCompany(userId: string, companyId: string): boolean {
    const access = this.companyAccess(userId, companyId)
    return access.companyRole ? ['owner', 'admin', 'member'].includes(access.companyRole) : AGENCY_WRITE_ROLES.includes(access.agencyRole as AgencyRole)
  }

  listAgencyClients(agencyId: string, userId: string): AgencyClientSummary[] {
    this.requireAgencyMembership(agencyId, userId)
    return this.db.all<AgencyClientRow>(
      `SELECT c.id,c.name,c.slug,
         (SELECT m.role FROM memberships m WHERE m.company_id=c.id AND m.user_id=?) AS role,
         (SELECT COUNT(*) FROM campaigns x WHERE x.company_id=c.id) AS campaignCount,
         (SELECT COUNT(*) FROM campaigns x WHERE x.company_id=c.id AND x.status IN ('scheduled','running')) AS activeCampaigns,
         (SELECT COUNT(*) FROM execution_jobs j WHERE j.company_id=c.id AND j.status IN ('queued','leased')) AS queuedJobs
       FROM companies c JOIN agency_clients ac ON ac.company_id=c.id WHERE ac.agency_id=? ORDER BY c.name,c.id`,
      [userId, agencyId],
    ).map((row) => ({
      ...row,
      role: row.role as CompanyRole | null,
      campaignCount: Number(row.campaignCount),
      activeCampaigns: Number(row.activeCampaigns),
      queuedJobs: Number(row.queuedJobs),
    }))
  }

  /* -------------------------------------------------------------- policies */

  ensurePolicy(companyId: string): AutomationPolicyRecord {
    const existing = this.getPolicy(companyId)
    if (existing) return existing
    this.db.run(
      `INSERT OR IGNORE INTO automation_policies
       (company_id,enabled,timezone,channels_json,max_posts_per_day,max_emails_per_day,allowed_hosts_json,quiet_start,quiet_end,kill_switch,version,updated_by,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [companyId, 0, 'Asia/Ho_Chi_Minh', JSON.stringify(['meta', 'linkedin', 'email']), 0, 0, JSON.stringify([]), null, null, 0, 1, null, nowIso()],
    )
    return this.getPolicy(companyId)!
  }

  getPolicy(companyId: string): AutomationPolicyRecord | undefined {
    const row = this.db.get<PolicyRow>('SELECT * FROM automation_policies WHERE company_id=?', [companyId])
    return row ? toPolicy(row) : undefined
  }

  updatePolicy(companyId: string, userId: string, patch: Partial<Omit<AutomationPolicyRecord, 'companyId' | 'version' | 'updatedBy' | 'updatedAt'>>): AutomationPolicyRecord {
    const current = this.ensurePolicy(companyId)
    const next = {
      enabled: patch.enabled ?? current.enabled,
      timezone: patch.timezone ?? current.timezone,
      channels: patch.channels ?? current.channels,
      maxPostsPerDay: patch.maxPostsPerDay ?? current.maxPostsPerDay,
      maxEmailsPerDay: patch.maxEmailsPerDay ?? current.maxEmailsPerDay,
      allowedHosts: patch.allowedHosts ?? current.allowedHosts,
      quietStart: patch.quietStart === undefined ? current.quietStart : patch.quietStart,
      quietEnd: patch.quietEnd === undefined ? current.quietEnd : patch.quietEnd,
      killSwitch: patch.killSwitch ?? current.killSwitch,
    }
    this.db.run(
      `UPDATE automation_policies SET enabled=?,timezone=?,channels_json=?,max_posts_per_day=?,max_emails_per_day=?,allowed_hosts_json=?,quiet_start=?,quiet_end=?,kill_switch=?,version=version+1,updated_by=?,updated_at=? WHERE company_id=?`,
      [next.enabled ? 1 : 0, next.timezone, JSON.stringify(next.channels), next.maxPostsPerDay, next.maxEmailsPerDay, JSON.stringify(next.allowedHosts), next.quietStart, next.quietEnd, next.killSwitch ? 1 : 0, userId, nowIso(), companyId],
    )
    if (next.killSwitch) {
      const at = nowIso()
      this.db.tx(() => {
        this.db.run("UPDATE execution_jobs SET status='cancelled',lease_until=NULL,updated_at=? WHERE company_id=? AND status IN ('queued','leased')", [at, companyId])
        this.db.run("UPDATE execution_attempts SET status='cancelled',finished_at=? WHERE company_id=? AND status='leased'", [at, companyId])
      })
    }
    return this.getPolicy(companyId)!
  }

  /* ------------------------------------------------------------- campaigns */

  createCampaign(input: {
    companyId: string
    userId: string
    name: string
    timezone: string
    objective?: string | null
    items: readonly {
      channel: CampaignChannel
      title: string
      content: string
      link?: string | null
      audienceId?: string | null
      scheduledAt?: string | null
    }[]
  }): CampaignWithItems {
    const campaignId = `cmpn_${newId().replaceAll('-', '').slice(0, 24)}`
    const at = nowIso()
    this.db.tx(() => {
      this.db.run(
        `INSERT INTO campaigns(id,company_id,name,status,timezone,objective,created_by,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [campaignId, input.companyId, input.name, 'draft', input.timezone, input.objective ?? null, input.userId, at, at],
      )
      for (const [index, item] of input.items.entries()) {
        this.insertItem(campaignId, input.companyId, item, index)
      }
    })
    return this.requireCampaign(input.companyId, campaignId)
  }

  private insertItem(campaignId: string, companyId: string, item: {
    channel: CampaignChannel
    title: string
    content: string
    link?: string | null
    audienceId?: string | null
    scheduledAt?: string | null
  }, index: number): CampaignItemRecord {
    if (item.audienceId && !this.db.get('SELECT id FROM audiences WHERE id=? AND company_id=?', [item.audienceId, companyId])) {
      throw notFound('Không tìm thấy audience trong client workspace')
    }
    const id = `citem_${newId().replaceAll('-', '').slice(0, 24)}`
    const key = `item:${campaignId}:${index}:${sha256(`${item.channel}|${item.title}|${item.content}|${item.scheduledAt ?? ''}`).slice(0, 24)}`
    const status: CampaignItemStatus = item.scheduledAt ? 'scheduled' : 'draft'
    this.db.run(
      `INSERT INTO campaign_items(id,company_id,campaign_id,channel,title,content,link,audience_id,scheduled_at,status,artifact_id,provider_ref,idempotency_key,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, companyId, campaignId, item.channel, item.title, item.content, item.link ?? null, item.audienceId ?? null, item.scheduledAt ?? null, status, null, null, key, nowIso(), nowIso()],
    )
    return this.requireItem(companyId, id)
  }

  listCampaigns(companyId: string): CampaignWithItems[] {
    return this.db.all<CampaignRow>(
      `SELECT id,company_id AS companyId,name,status,timezone,objective,created_by AS createdBy,created_at AS createdAt,updated_at AS updatedAt
       FROM campaigns WHERE company_id=? ORDER BY updated_at DESC,id DESC`,
      [companyId],
    ).map((row) => ({ ...row, status: row.status as CampaignStatus, items: this.listItems(companyId, row.id) }))
  }

  requireCampaign(companyId: string, campaignId: string): CampaignWithItems {
    const row = this.db.get<CampaignRow>(
      `SELECT id,company_id AS companyId,name,status,timezone,objective,created_by AS createdBy,created_at AS createdAt,updated_at AS updatedAt
       FROM campaigns WHERE id=? AND company_id=?`,
      [campaignId, companyId],
    )
    if (!row) throw notFound('Không tìm thấy chiến dịch')
    return { ...row, status: row.status as CampaignStatus, items: this.listItems(companyId, campaignId) }
  }

  private listItems(companyId: string, campaignId: string): CampaignItemRecord[] {
    return this.db.all<CampaignItemRow>(
      `SELECT id,company_id AS companyId,campaign_id AS campaignId,channel,title,content,link,audience_id AS audienceId,
       scheduled_at AS scheduledAt,status,artifact_id AS artifactId,provider_ref AS providerRef,idempotency_key AS idempotencyKey,created_at AS createdAt,updated_at AS updatedAt
       FROM campaign_items WHERE company_id=? AND campaign_id=? ORDER BY scheduled_at IS NULL,scheduled_at,id`,
      [companyId, campaignId],
    ).map((item) => ({ ...item, channel: item.channel as CampaignChannel, status: item.status as CampaignItemStatus }))
  }

  requireItem(companyId: string, itemId: string): CampaignItemRecord {
    const row = this.db.get<CampaignItemRow>(
      `SELECT id,company_id AS companyId,campaign_id AS campaignId,channel,title,content,link,audience_id AS audienceId,
       scheduled_at AS scheduledAt,status,artifact_id AS artifactId,provider_ref AS providerRef,idempotency_key AS idempotencyKey,created_at AS createdAt,updated_at AS updatedAt
       FROM campaign_items WHERE id=? AND company_id=?`,
      [itemId, companyId],
    )
    if (!row) throw notFound('Không tìm thấy nội dung chiến dịch')
    return { ...row, channel: row.channel as CampaignChannel, status: row.status as CampaignItemStatus }
  }

  activateCampaign(companyId: string, campaignId: string): CampaignWithItems {
    const campaign = this.requireCampaign(companyId, campaignId)
    if (campaign.status === 'completed') return campaign
    this.db.tx(() => {
      const at = nowIso()
      this.db.run("UPDATE campaigns SET status='scheduled',updated_at=? WHERE id=? AND company_id=?", [at, campaignId, companyId])
      this.db.run("UPDATE campaign_items SET status='scheduled',updated_at=? WHERE campaign_id=? AND company_id=? AND status IN ('draft','failed')", [at, campaignId, companyId])
      const items = this.listItems(companyId, campaignId)
      for (const item of items) {
        if (item.status === 'cancelled' || item.status === 'suppressed') continue
        const runAt = item.scheduledAt ?? at
        this.queueItemJobs(companyId, item, runAt)
      }
      this.finalizeCampaignIfTerminal(companyId, campaignId, at)
    })
    return this.requireCampaign(companyId, campaignId)
  }

  pauseCampaign(companyId: string, campaignId: string): CampaignWithItems {
    this.requireCampaign(companyId, campaignId)
    this.db.tx(() => {
      const at = nowIso()
      this.db.run("UPDATE campaigns SET status='paused',updated_at=? WHERE id=? AND company_id=?", [at, campaignId, companyId])
      this.db.run("UPDATE execution_jobs SET status='cancelled',updated_at=? WHERE company_id=? AND campaign_item_id IN (SELECT id FROM campaign_items WHERE campaign_id=?) AND status IN ('queued','leased')", [at, companyId, campaignId])
      this.db.run("UPDATE execution_attempts SET status='cancelled',finished_at=? WHERE company_id=? AND job_id IN (SELECT id FROM execution_jobs WHERE company_id=? AND campaign_item_id IN (SELECT id FROM campaign_items WHERE campaign_id=?)) AND status='leased'", [at, companyId, companyId, campaignId])
      this.db.run("UPDATE campaign_items SET status='cancelled',updated_at=? WHERE campaign_id=? AND status IN ('draft','scheduled','running')", [at, campaignId])
    })
    return this.requireCampaign(companyId, campaignId)
  }

  resumeCampaign(companyId: string, campaignId: string): CampaignWithItems {
    this.requireCampaign(companyId, campaignId)
    this.db.tx(() => {
      const at = nowIso()
      this.db.run("UPDATE campaigns SET status='scheduled',updated_at=? WHERE id=? AND company_id=?", [at, campaignId, companyId])
      this.db.run("UPDATE campaign_items SET status='scheduled',updated_at=? WHERE campaign_id=? AND status='cancelled'", [at, campaignId])
      for (const item of this.listItems(companyId, campaignId)) {
        if (item.status === 'cancelled' || item.status === 'suppressed') continue
        this.queueItemJobs(companyId, item, item.scheduledAt ?? at)
      }
      this.finalizeCampaignIfTerminal(companyId, campaignId, at)
    })
    return this.requireCampaign(companyId, campaignId)
  }

  private queueItemJobs(companyId: string, item: CampaignItemRecord, runAt: string): void {
    if (item.channel === 'email' && item.audienceId) {
      const contacts = this.db.all<{ id: string }>("SELECT id FROM audience_contacts WHERE audience_id=? AND company_id=? AND consent_status='opted_in' ORDER BY id", [item.audienceId, companyId])
      if (contacts.length === 0) {
        this.db.run("UPDATE campaign_items SET status='suppressed',updated_at=? WHERE id=?", [nowIso(), item.id])
        return
      }
      for (const contact of contacts) this.queueJob(companyId, item.id, runAt, `${item.idempotencyKey}:contact:${contact.id}`, contact.id)
      return
    }
    this.queueJob(companyId, item.id, runAt, item.idempotencyKey, null)
  }

  private queueJob(companyId: string, itemId: string, runAt: string, idempotencyKey: string, contactId: string | null): void {
    this.db.run(
      `INSERT INTO execution_jobs(id,company_id,campaign_item_id,contact_id,status,run_at,lease_until,attempts,idempotency_key,provider_request_id,error,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(company_id,idempotency_key) DO UPDATE SET status='queued',run_at=excluded.run_at,lease_until=NULL,error=NULL,updated_at=excluded.updated_at
       WHERE execution_jobs.status IN ('cancelled','failed')`,
      [`job_${newId().replaceAll('-', '').slice(0, 24)}`, companyId, itemId, contactId, 'queued', runAt, null, 0, idempotencyKey, null, null, nowIso(), nowIso()],
    )
  }

  private finalizeCampaignIfTerminal(companyId: string, campaignId: string, at = nowIso()): void {
    const unfinished = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM campaign_items WHERE company_id=? AND campaign_id=? AND status NOT IN ('accepted','failed','cancelled','suppressed')", [companyId, campaignId])?.n ?? 0
    const pending = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM execution_jobs WHERE company_id=? AND campaign_item_id IN (SELECT id FROM campaign_items WHERE campaign_id=?) AND status IN ('queued','leased')", [companyId, campaignId])?.n ?? 0
    if (unfinished === 0 && pending === 0) this.db.run("UPDATE campaigns SET status='completed',updated_at=? WHERE id=? AND company_id=?", [at, campaignId, companyId])
  }

  /* -------------------------------------------------------------- audience */

  createAudience(companyId: string, name: string): AudienceRecord {
    const id = `aud_${newId().replaceAll('-', '').slice(0, 24)}`
    try {
      this.db.run('INSERT INTO audiences(id,company_id,name,created_at) VALUES(?,?,?,?)', [id, companyId, name, nowIso()])
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw conflict('Tên audience đã tồn tại')
      throw error
    }
    return this.requireAudience(companyId, id)
  }

  requireAudience(companyId: string, audienceId: string): AudienceRecord {
    const row = this.db.get<AudienceRow>('SELECT id,company_id AS companyId,name,created_at AS createdAt FROM audiences WHERE id=? AND company_id=?', [audienceId, companyId])
    if (!row) throw notFound('Không tìm thấy audience')
    return row
  }

  listAudiences(companyId: string): Array<AudienceRecord & { contactCount: number; optedInCount: number; unsubscribedCount: number }> {
    return this.db.all<AudienceStatsRow>(
      `SELECT a.id,a.company_id AS companyId,a.name,a.created_at AS createdAt,
       COUNT(c.id) AS contactCount,
       SUM(CASE WHEN c.consent_status='opted_in' THEN 1 ELSE 0 END) AS optedInCount,
       SUM(CASE WHEN c.consent_status='unsubscribed' THEN 1 ELSE 0 END) AS unsubscribedCount
       FROM audiences a LEFT JOIN audience_contacts c ON c.audience_id=a.id
       WHERE a.company_id=? GROUP BY a.id ORDER BY a.name,a.id`,
      [companyId],
    ).map((row) => ({ ...row, contactCount: Number(row.contactCount), optedInCount: Number(row.optedInCount), unsubscribedCount: Number(row.unsubscribedCount) }))
  }

  importContacts(companyId: string, audienceId: string, contacts: readonly { email: string; name?: string | null; source: string; consentAt: string; consentVersion: string }[]): ContactImportResult {
    this.requireAudience(companyId, audienceId)
    let inserted = 0
    let updated = 0
    let skippedUnsubscribed = 0
    this.db.tx(() => {
      for (const contact of contacts) {
        const email = contact.email.trim().toLowerCase()
        const old = this.db.get<ContactRow>('SELECT * FROM audience_contacts WHERE audience_id=? AND email=?', [audienceId, email])
        if (!old) {
          const id = `ct_${newId().replaceAll('-', '').slice(0, 24)}`
          const at = nowIso()
          this.db.run(
            `INSERT INTO audience_contacts(id,company_id,audience_id,email,name,consent_status,source,consent_at,consent_version,unsubscribed_at,created_at,updated_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
            [id, companyId, audienceId, email, contact.name ?? null, 'opted_in', contact.source, contact.consentAt, contact.consentVersion, null, at, at],
          )
          this.insertConsentEvent(companyId, id, 'imported', contact.source, { consentVersion: contact.consentVersion })
          inserted += 1
        } else if (old.consent_status === 'unsubscribed') {
          skippedUnsubscribed += 1
        } else {
          this.db.run(
            `UPDATE audience_contacts SET name=?,consent_status='opted_in',source=?,consent_at=?,consent_version=?,updated_at=? WHERE id=? AND company_id=?`,
            [contact.name ?? old.name, contact.source, contact.consentAt, contact.consentVersion, nowIso(), old.id, companyId],
          )
          this.insertConsentEvent(companyId, old.id, 'imported', contact.source, { consentVersion: contact.consentVersion })
          updated += 1
        }
      }
    })
    return { inserted, updated, skippedUnsubscribed }
  }

  listContacts(companyId: string, audienceId: string, limit = 500): AudienceContactRecord[] {
    this.requireAudience(companyId, audienceId)
    return this.db.all<ContactRow>(
      `SELECT id,company_id AS companyId,audience_id AS audienceId,email,name,consent_status AS consentStatus,source,consent_at AS consentAt,consent_version AS consentVersion,unsubscribed_at AS unsubscribedAt,created_at AS createdAt,updated_at AS updatedAt
       FROM audience_contacts WHERE company_id=? AND audience_id=? ORDER BY email LIMIT ?`,
      [companyId, audienceId, Math.max(1, Math.min(10_000, limit))],
    ).map((row) => ({
      id: row.id,
      companyId: row.companyId ?? row.company_id,
      audienceId: row.audienceId ?? row.audience_id,
      email: row.email,
      name: row.name,
      consentStatus: (row.consentStatus ?? row.consent_status) as ConsentStatus,
      source: row.source,
      consentAt: row.consentAt ?? row.consent_at,
      consentVersion: row.consentVersion ?? row.consent_version,
      unsubscribedAt: row.unsubscribedAt ?? row.unsubscribed_at,
      createdAt: row.createdAt ?? row.created_at,
      updatedAt: row.updatedAt ?? row.updated_at,
    }))
  }

  requireContact(companyId: string, contactId: string): AudienceContactRecord {
    const row = this.db.get<ContactRow>(
      `SELECT id,company_id AS companyId,audience_id AS audienceId,email,name,consent_status AS consentStatus,source,consent_at AS consentAt,consent_version AS consentVersion,unsubscribed_at AS unsubscribedAt,created_at AS createdAt,updated_at AS updatedAt
       FROM audience_contacts WHERE id=? AND company_id=?`,
      [contactId, companyId],
    )
    if (!row) throw notFound('Không tìm thấy contact')
    return {
      id: row.id,
      companyId: row.companyId ?? row.company_id,
      audienceId: row.audienceId ?? row.audience_id,
      email: row.email,
      name: row.name,
      consentStatus: (row.consentStatus ?? row.consent_status) as ConsentStatus,
      source: row.source,
      consentAt: row.consentAt ?? row.consent_at,
      consentVersion: row.consentVersion ?? row.consent_version,
      unsubscribedAt: row.unsubscribedAt ?? row.unsubscribed_at,
      createdAt: row.createdAt ?? row.created_at,
      updatedAt: row.updatedAt ?? row.updated_at,
    }
  }

  unsubscribe(contactId: string, source = 'public_unsubscribe'): AudienceContactRecord {
    const old = this.db.get<ContactRow>('SELECT * FROM audience_contacts WHERE id=?', [contactId])
    if (!old) throw notFound('Không tìm thấy contact')
    const at = nowIso()
    this.db.tx(() => {
      this.db.run("UPDATE audience_contacts SET consent_status='unsubscribed',unsubscribed_at=?,updated_at=? WHERE id=?", [at, at, contactId])
      this.insertConsentEvent(old.company_id, contactId, 'unsubscribe', source)
    })
    return this.db.get<AudienceContactRecord>(
      `SELECT id,company_id AS companyId,audience_id AS audienceId,email,name,consent_status AS consentStatus,source,consent_at AS consentAt,consent_version AS consentVersion,unsubscribed_at AS unsubscribedAt,created_at AS createdAt,updated_at AS updatedAt
       FROM audience_contacts WHERE id=?`,
      [contactId],
    )!
  }

  makeUnsubscribeToken(contactId: string, expiresAt = Date.now() + 730 * 24 * 60 * 60 * 1000): string {
    const contact = this.db.get<{ id: string; company_id: string }>('SELECT id,company_id FROM audience_contacts WHERE id=?', [contactId])
    if (!contact) throw notFound('Không tìm thấy contact')
    const encrypted = this.secrets.encrypt(JSON.stringify({ contactId, companyId: contact.company_id, expiresAt }))
    return Buffer.from(JSON.stringify(encrypted), 'utf8').toString('base64url')
  }

  resolveUnsubscribeToken(token: string): { contactId: string; companyId: string } {
    try {
      const raw = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as { enc?: string; iv?: string }
      const payload = JSON.parse(this.secrets.decrypt(raw.enc ?? '', raw.iv ?? '')) as { contactId?: string; companyId?: string; expiresAt?: number }
      if (!payload.contactId || !payload.companyId || !payload.expiresAt || payload.expiresAt < Date.now()) throw new Error('token expired')
      const exists = this.db.get('SELECT id FROM audience_contacts WHERE id=? AND company_id=?', [payload.contactId, payload.companyId])
      if (!exists) throw new Error('contact missing')
      return { contactId: payload.contactId, companyId: payload.companyId }
    } catch {
      throw notFound('Liên kết huỷ đăng ký không hợp lệ hoặc đã hết hạn')
    }
  }

  private insertConsentEvent(companyId: string, contactId: string, kind: ConsentEventKind, source: string, metadata?: unknown): void {
    this.db.run('INSERT INTO consent_events(id,company_id,contact_id,kind,source,occurred_at,metadata_json) VALUES(?,?,?,?,?,?,?)', [newId(), companyId, contactId, kind, source, nowIso(), metadata === undefined ? null : JSON.stringify(metadata)])
  }

  /* --------------------------------------------------------------- workers */

  leaseDueJobs(now = new Date(), leaseMs = 60_000, limit = 20): LeasedJob[] {
    const nowText = now.toISOString()
    const leaseUntil = new Date(now.getTime() + leaseMs).toISOString()
    return this.db.tx(() => {
      const rows = this.db.all<JobRow>(
        `SELECT j.id,j.company_id AS companyId,j.campaign_item_id AS campaignItemId,j.contact_id AS contactId,j.status,j.run_at AS runAt,j.lease_until AS leaseUntil,j.attempts,j.idempotency_key AS idempotencyKey,j.provider_request_id AS providerRequestId,j.error,j.created_at AS createdAt,j.updated_at AS updatedAt
         FROM execution_jobs j WHERE (j.status='queued' AND j.run_at<=?) OR (j.status='leased' AND j.lease_until<=?)
         ORDER BY j.run_at,j.id LIMIT ?`,
        [nowText, nowText, Math.max(1, Math.min(100, limit))],
      )
      const leased: LeasedJob[] = []
      for (const row of rows) {
        const updated = this.db.run(
          `UPDATE execution_jobs SET status='leased',lease_until=?,attempts=attempts+1,updated_at=? WHERE id=? AND status IN ('queued','leased')`,
          [leaseUntil, nowText, row.id],
        )
        if (updated.changes !== 1) continue
        const attempt = row.attempts + 1
        this.db.run('INSERT INTO execution_attempts(id,company_id,job_id,attempt,status,provider_request_id,error,started_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?)', [newId(), row.companyId, row.id, attempt, 'leased', null, null, nowText, null])
        const item = this.requireItem(row.companyId, row.campaignItemId)
        leased.push({ ...row, status: 'leased', leaseUntil, attempts: attempt, updatedAt: nowText, item })
      }
      return leased
    })
  }

  completeJob(jobId: string, status: Extract<ExecutionJobStatus, 'accepted' | 'failed' | 'suppressed' | 'cancelled'>, providerRequestId: string | null, error: string | null): ExecutionJobRecord {
    const job = this.db.get<JobRow>('SELECT id,company_id AS companyId,campaign_item_id AS campaignItemId,contact_id AS contactId,status,run_at AS runAt,lease_until AS leaseUntil,attempts,idempotency_key AS idempotencyKey,provider_request_id AS providerRequestId,error,created_at AS createdAt,updated_at AS updatedAt FROM execution_jobs WHERE id=?', [jobId])
    if (!job) throw notFound('Không tìm thấy execution job')
    const at = nowIso()
    this.db.tx(() => {
      this.db.run("UPDATE execution_jobs SET status=?,lease_until=NULL,provider_request_id=?,error=?,updated_at=? WHERE id=?", [status, providerRequestId, error, at, jobId])
      this.db.run('UPDATE execution_attempts SET status=?,provider_request_id=?,error=?,finished_at=? WHERE job_id=? AND attempt=?', [status, providerRequestId, error, at, jobId, job.attempts])
      const pendingJobs = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM execution_jobs WHERE campaign_item_id=? AND status IN ('queued','leased')", [job.campaignItemId])?.n ?? 0
      if (pendingJobs === 0) {
        const failedJobs = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM execution_jobs WHERE campaign_item_id=? AND status='failed'", [job.campaignItemId])?.n ?? 0
        const acceptedJobs = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM execution_jobs WHERE campaign_item_id=? AND status='accepted'", [job.campaignItemId])?.n ?? 0
        const itemStatus: CampaignItemStatus = failedJobs > 0 ? 'failed' : acceptedJobs > 0 ? 'accepted' : status
        this.db.run('UPDATE campaign_items SET status=?,provider_ref=?,updated_at=? WHERE id=?', [itemStatus, providerRequestId, at, job.campaignItemId])
      } else {
        this.db.run("UPDATE campaign_items SET status='running',updated_at=? WHERE id=? AND status IN ('scheduled','draft')", [at, job.campaignItemId])
      }
      const remaining = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM campaign_items WHERE campaign_id=(SELECT campaign_id FROM campaign_items WHERE id=?) AND status NOT IN ('accepted','failed','cancelled','suppressed')", [job.campaignItemId])?.n ?? 0
      const pendingCampaignJobs = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM execution_jobs WHERE company_id=? AND campaign_item_id IN (SELECT id FROM campaign_items WHERE campaign_id=(SELECT campaign_id FROM campaign_items WHERE id=?)) AND status IN ('queued','leased')", [job.companyId, job.campaignItemId])?.n ?? 0
      if (remaining === 0 && pendingCampaignJobs === 0) this.db.run("UPDATE campaigns SET status='completed',updated_at=? WHERE id=(SELECT campaign_id FROM campaign_items WHERE id=?)", [at, job.campaignItemId])
    })
    return { ...job, status, leaseUntil: null, providerRequestId, error, updatedAt: at }
  }

  rescheduleJob(jobId: string, runAt: string, error: string): ExecutionJobRecord {
    const job = this.db.get<JobRow>('SELECT id,company_id AS companyId,campaign_item_id AS campaignItemId,contact_id AS contactId,status,run_at AS runAt,lease_until AS leaseUntil,attempts,idempotency_key AS idempotencyKey,provider_request_id AS providerRequestId,error,created_at AS createdAt,updated_at AS updatedAt FROM execution_jobs WHERE id=?', [jobId])
    if (!job) throw notFound('Không tìm thấy execution job')
    const at = nowIso()
    this.db.tx(() => {
      this.db.run("UPDATE execution_jobs SET status='queued',run_at=?,lease_until=NULL,error=?,updated_at=? WHERE id=?", [runAt, error, at, jobId])
      this.db.run('UPDATE execution_attempts SET status=\'failed\',error=?,finished_at=? WHERE job_id=? AND attempt=?', [error, at, jobId, job.attempts])
    })
    return { ...job, status: 'queued', runAt, leaseUntil: null, error, updatedAt: at }
  }

  listJobs(companyId: string, limit = 200): ExecutionJobRecord[] {
    return this.db.all<JobRow>('SELECT id,company_id AS companyId,campaign_item_id AS campaignItemId,contact_id AS contactId,status,run_at AS runAt,lease_until AS leaseUntil,attempts,idempotency_key AS idempotencyKey,provider_request_id AS providerRequestId,error,created_at AS createdAt,updated_at AS updatedAt FROM execution_jobs WHERE company_id=? ORDER BY run_at DESC,id DESC LIMIT ?', [companyId, Math.max(1, Math.min(1000, limit))]).map((row) => ({ ...row, status: row.status as ExecutionJobStatus }))
  }

  listAttempts(companyId: string, jobId: string): ExecutionAttemptRecord[] {
    if (!this.db.get('SELECT id FROM execution_jobs WHERE id=? AND company_id=?', [jobId, companyId])) throw notFound('Không tìm thấy execution job')
    return this.db.all<ExecutionAttemptRecord>(
      `SELECT id,company_id AS companyId,job_id AS jobId,attempt,status,provider_request_id AS providerRequestId,error,started_at AS startedAt,finished_at AS finishedAt
       FROM execution_attempts WHERE company_id=? AND job_id=? ORDER BY attempt`,
      [companyId, jobId],
    ).map((row) => ({ ...row, status: row.status as ExecutionJobStatus }))
  }

  isJobLeased(jobId: string, now = new Date()): boolean {
    return Boolean(this.db.get<{ id: string }>("SELECT id FROM execution_jobs WHERE id=? AND status='leased' AND lease_until>?", [jobId, now.toISOString()]))
  }

  countAcceptedForDay(companyId: string, channel: CampaignChannel, date: string, timeZone = 'UTC'): number {
    const rows = this.db.all<{ updatedAt: string }>(
      `SELECT j.updated_at AS updatedAt FROM execution_jobs j JOIN campaign_items i ON i.id=j.campaign_item_id
       WHERE j.company_id=? AND i.channel=? AND j.status='accepted'`,
      [companyId, channel],
    )
    return rows.filter((row) => {
      try {
        return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(row.updatedAt)) === date
      } catch {
        return row.updatedAt.slice(0, 10) === date
      }
    }).length
  }

  /* --------------------------------------------------------------- metrics */

  upsertMetric(companyId: string, input: { campaignItemId: string; channel: CampaignChannel; metricDate: string; metrics: Record<string, number | string> }): MetricSnapshotRecord {
    this.requireItem(companyId, input.campaignItemId)
    const id = `metric_${newId().replaceAll('-', '').slice(0, 24)}`
    const at = nowIso()
    this.db.run(
      `INSERT INTO metric_snapshots(id,company_id,campaign_item_id,channel,metric_date,metrics_json,created_at)
       VALUES(?,?,?,?,?,?,?) ON CONFLICT(campaign_item_id,metric_date) DO UPDATE SET channel=excluded.channel,metrics_json=excluded.metrics_json,created_at=excluded.created_at`,
      [id, companyId, input.campaignItemId, input.channel, input.metricDate, JSON.stringify(input.metrics), at],
    )
    return this.db.get<MetricSnapshotRecord>('SELECT id,company_id AS companyId,campaign_item_id AS campaignItemId,channel,metric_date AS metricDate,metrics_json AS metricsJson,created_at AS createdAt FROM metric_snapshots WHERE campaign_item_id=? AND metric_date=?', [input.campaignItemId, input.metricDate])!
  }

  incrementMetric(companyId: string, input: { campaignItemId: string; channel: CampaignChannel; metricDate: string; metrics: Record<string, number> }): MetricSnapshotRecord {
    const existing = this.db.get<{ metricsJson: string }>('SELECT metrics_json AS metricsJson FROM metric_snapshots WHERE company_id=? AND campaign_item_id=? AND metric_date=?', [companyId, input.campaignItemId, input.metricDate])
    const merged: Record<string, number> = {}
    if (existing) {
      try {
        const parsed = JSON.parse(existing.metricsJson) as Record<string, unknown>
        for (const [key, value] of Object.entries(parsed)) if (typeof value === 'number' && Number.isFinite(value)) merged[key] = value
      } catch { /* replace with the new counters */ }
    }
    for (const [key, value] of Object.entries(input.metrics)) merged[key] = (merged[key] ?? 0) + value
    return this.upsertMetric(companyId, { ...input, metrics: merged })
  }

  listMetrics(companyId: string, limit = 200): MetricSnapshotRecord[] {
    return this.db.all<MetricSnapshotRecord>('SELECT id,company_id AS companyId,campaign_item_id AS campaignItemId,channel,metric_date AS metricDate,metrics_json AS metricsJson,created_at AS createdAt FROM metric_snapshots WHERE company_id=? ORDER BY metric_date DESC,created_at DESC LIMIT ?', [companyId, Math.max(1, Math.min(1000, limit))]).map((row) => ({ ...row, channel: row.channel as CampaignChannel }))
  }
}

interface AgencyRow extends AgencyRecord { readonly role?: AgencyRole }
interface AgencyMembershipRow { readonly agencyId: string; readonly userId: string; readonly role: AgencyRole; readonly createdAt: string }
interface AgencyClientRow { readonly id: string; readonly name: string; readonly slug: string; readonly role: string | null; readonly campaignCount: number; readonly activeCampaigns: number; readonly queuedJobs: number }
interface PolicyRow { readonly company_id: string; readonly enabled: number; readonly timezone: string; readonly channels_json: string; readonly max_posts_per_day: number; readonly max_emails_per_day: number; readonly allowed_hosts_json: string; readonly quiet_start: string | null; readonly quiet_end: string | null; readonly kill_switch: number; readonly version: number; readonly updated_by: string | null; readonly updated_at: string }
interface CampaignRow extends Omit<CampaignRecord, 'status'> { readonly status: string }
interface CampaignItemRow extends Omit<CampaignItemRecord, 'channel' | 'status'> { readonly channel: string; readonly status: string }
interface AudienceRow extends AudienceRecord {}
interface AudienceStatsRow extends AudienceRow { readonly contactCount: number; readonly optedInCount: number; readonly unsubscribedCount: number }
interface ContactRow { readonly id: string; readonly company_id: string; readonly companyId?: string; readonly audience_id: string; readonly audienceId?: string; readonly email: string; readonly name: string | null; readonly consent_status: string; readonly consentStatus?: string; readonly source: string | null; readonly consent_at: string | null; readonly consentAt?: string | null; readonly consent_version: string | null; readonly consentVersion?: string | null; readonly unsubscribed_at: string | null; readonly unsubscribedAt?: string | null; readonly created_at: string; readonly createdAt?: string; readonly updated_at: string; readonly updatedAt?: string }
interface JobRow extends Omit<ExecutionJobRecord, 'status'> { readonly status: string }

function toPolicy(row: PolicyRow): AutomationPolicyRecord {
  let channels: CampaignChannel[] = ['meta', 'linkedin', 'email']
  try {
    const parsed = JSON.parse(row.channels_json) as unknown
    if (Array.isArray(parsed)) channels = parsed.filter((value): value is CampaignChannel => value === 'meta' || value === 'linkedin' || value === 'email')
  } catch { /* keep safe default */ }
  let allowedHosts: string[] = []
  try {
    const parsed = JSON.parse(row.allowed_hosts_json) as unknown
    if (Array.isArray(parsed)) allowedHosts = parsed.filter((value): value is string => typeof value === 'string' && value.length > 0)
  } catch { /* keep safe default */ }
  return {
    companyId: row.company_id,
    enabled: row.enabled === 1,
    timezone: row.timezone,
    channels,
    maxPostsPerDay: row.max_posts_per_day,
    maxEmailsPerDay: row.max_emails_per_day,
    allowedHosts,
    quietStart: row.quiet_start,
    quietEnd: row.quiet_end,
    killSwitch: row.kill_switch === 1,
    version: row.version,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }
}


import {
  forbidden,
  notFound,
  conflict,
  newId,
  nowIso,
  type WordpressSiteInput,
  type WordpressSiteView,
  type WordpressJobInput,
  type WordpressJobView,
} from '@marketing-agent/shared'
import type { Database } from '../database.ts'
import type { SecretBox } from '../crypto.ts'

const SITE = `id,company_id AS companyId,name,url,environment,username,browser_channel_id AS browserChannelId,seo_plugin AS seoPlugin,enabled,capabilities_json,checked_at AS checkedAt,created_at AS createdAt`
const JOB = `id,company_id AS companyId,site_id AS siteId,actor_id AS actorId,action,input_json,status,snapshot_json,result_json,error,approval_hash AS approvalHash,approved_by AS approvedBy,created_at AS createdAt,updated_at AS updatedAt`
type SiteRow = Omit<WordpressSiteView, 'enabled' | 'capabilities'> & {
  enabled: number
  capabilities_json: string
}
type JobRow = Omit<WordpressJobView, 'input' | 'snapshot' | 'result'> & {
  input_json: string
  snapshot_json: string | null
  result_json: string | null
}
const siteView = (r: SiteRow): WordpressSiteView => {
  const { capabilities_json, ...rest } = r
  return {
    ...rest,
    enabled: r.enabled === 1,
    capabilities: JSON.parse(capabilities_json),
  }
}
const jobView = (r: JobRow): WordpressJobView => {
  const { input_json, snapshot_json, result_json, ...rest } = r
  return {
    ...rest,
    input: JSON.parse(input_json),
    snapshot: snapshot_json ? JSON.parse(snapshot_json) : null,
    result: result_json ? JSON.parse(result_json) : null,
  }
}

export class WordpressRepo {
  constructor(
    readonly db: Database,
    private readonly secrets: SecretBox,
  ) {}
  manage(companyId: string, actorId?: string): void {
    const m = actorId
      ? this.db.get<{ role: string; approval_status: string }>(
          'SELECT m.role,u.approval_status FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=? AND m.user_id=?',
          [companyId, actorId],
        )
      : undefined
    if (
      !m ||
      !['owner', 'admin'].includes(m.role) ||
      m.approval_status !== 'approved'
    )
      throw forbidden('Cần owner/admin đã duyệt để quản trị WordPress')
  }
  sites(companyId: string): WordpressSiteView[] {
    return this.db
      .all<SiteRow>(
        `SELECT ${SITE} FROM wordpress_sites WHERE company_id=? ORDER BY created_at,id`,
        [companyId],
      )
      .map(siteView)
  }
  site(companyId: string, id: string): WordpressSiteView {
    const r = this.db.get<SiteRow>(
      `SELECT ${SITE} FROM wordpress_sites WHERE company_id=? AND id=?`,
      [companyId, id],
    )
    if (!r) throw notFound('Không tìm thấy website')
    return siteView(r)
  }
  save(companyId: string, input: WordpressSiteInput): WordpressSiteView {
    if (input.browserChannelId)
      this.db.get(
        'SELECT id FROM browser_channels WHERE company_id=? AND id=?',
        [companyId, input.browserChannelId],
      ) ||
        (() => {
          throw notFound('Không tìm thấy kênh browser')
        })()
    const secret = this.secrets.encrypt(input.applicationPassword),
      id = newId()
    this.db.run(
      'INSERT INTO wordpress_sites(id,company_id,name,url,environment,username,password_enc,password_iv,browser_channel_id,seo_plugin,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [
        id,
        companyId,
        input.name,
        input.url.replace(/\/+$/, ''),
        input.environment,
        input.username,
        secret.enc,
        secret.iv,
        input.browserChannelId ?? null,
        input.seoPlugin ?? null,
        nowIso(),
      ],
    )
    return this.site(companyId, id)
  }
  disable(companyId: string, id: string): void {
    this.site(companyId, id)
    if (
      this.db.get(
        "SELECT id FROM wordpress_jobs WHERE site_id=? AND status='running'",
        [id],
      )
    )
      throw conflict('Website đang có job chạy')
    this.db.run(
      'UPDATE wordpress_sites SET enabled=0 WHERE company_id=? AND id=?',
      [companyId, id],
    )
    this.db.run(
      "UPDATE wordpress_jobs SET status='cancelled',updated_at=? WHERE company_id=? AND site_id=? AND status IN ('queued','awaiting_approval','waiting_human')",
      [nowIso(), companyId, id],
    )
  }
  update(
    companyId: string,
    id: string,
    input: Partial<WordpressSiteInput> & { enabled?: boolean },
  ): WordpressSiteView {
    this.site(companyId, id)
    if (
      this.db.get(
        "SELECT id FROM wordpress_jobs WHERE site_id=? AND status='running'",
        [id],
      )
    )
      throw conflict('Chờ job đang chạy hoàn tất trước khi sửa kết nối')
    if (
      input.browserChannelId &&
      !this.db.get(
        'SELECT id FROM browser_channels WHERE company_id=? AND id=?',
        [companyId, input.browserChannelId],
      )
    )
      throw notFound('Không tìm thấy kênh browser')
    const fields: Record<string, unknown> = {}
    for (const key of ['name', 'username', 'environment'] as const)
      if (input[key] !== undefined) fields[key] = input[key]
    if (input.url !== undefined) fields.url = input.url.replace(/\/+$/, '')
    if (input.enabled !== undefined) fields.enabled = input.enabled ? 1 : 0
    if (input.browserChannelId !== undefined)
      fields.browser_channel_id = input.browserChannelId
    if (input.seoPlugin !== undefined) fields.seo_plugin = input.seoPlugin
    if (input.applicationPassword) {
      const secret = this.secrets.encrypt(input.applicationPassword)
      fields.password_enc = secret.enc
      fields.password_iv = secret.iv
    }
    this.db.tx(() => {
      if (Object.keys(fields).length)
        this.db.run(
          `UPDATE wordpress_sites SET ${Object.keys(fields)
            .map((k) => `${k}=?`)
            .join(
              ',',
            )},capabilities_json='{}',checked_at=NULL WHERE company_id=? AND id=?`,
          [...Object.values(fields), companyId, id],
        )
      this.db.run(
        "UPDATE wordpress_jobs SET status='cancelled',updated_at=? WHERE company_id=? AND site_id=? AND status IN ('queued','awaiting_approval','waiting_human')",
        [nowIso(), companyId, id],
      )
    })
    return this.site(companyId, id)
  }
  credentials(
    companyId: string,
    id: string,
  ): { username: string; password: string } {
    const r = this.db.get<{
      username: string
      password_enc: string
      password_iv: string
    }>(
      'SELECT username,password_enc,password_iv FROM wordpress_sites WHERE company_id=? AND id=? AND enabled=1',
      [companyId, id],
    )
    if (!r) throw notFound('Kết nối WordPress bị thu hồi')
    return {
      username: r.username,
      password: this.secrets.decrypt(r.password_enc, r.password_iv),
    }
  }
  checked(
    companyId: string,
    id: string,
    capabilities: Record<string, unknown>,
  ): void {
    this.site(companyId, id)
    this.db.run(
      'UPDATE wordpress_sites SET capabilities_json=?,checked_at=? WHERE company_id=? AND id=?',
      [JSON.stringify(capabilities), nowIso(), companyId, id],
    )
  }
  enqueue(
    companyId: string,
    actorId: string,
    input: WordpressJobInput,
  ): WordpressJobView {
    this.manage(companyId, actorId)
    const site = this.site(companyId, input.siteId)
    if (!site.enabled) throw conflict('Kết nối đã tắt')
    const old = this.db.get<JobRow>(
      `SELECT ${JOB} FROM wordpress_jobs WHERE company_id=? AND site_id=? AND idempotency_key=?`,
      [companyId, site.id, input.idempotencyKey],
    )
    if (old) {
      if (old.input_json !== JSON.stringify(input))
        throw conflict('Idempotency key đã được dùng cho yêu cầu khác')
      return jobView(old)
    }
    const id = newId(),
      now = nowIso()
    this.db.run(
      'INSERT INTO wordpress_jobs(id,company_id,site_id,actor_id,action,input_json,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
      [
        id,
        companyId,
        site.id,
        actorId,
        input.action,
        JSON.stringify(input),
        input.idempotencyKey,
        now,
        now,
      ],
    )
    this.event(companyId, site.id, id, 'queued', {})
    return this.job(companyId, id)
  }
  job(companyId: string, id: string): WordpressJobView {
    const r = this.db.get<JobRow>(
      `SELECT ${JOB} FROM wordpress_jobs WHERE company_id=? AND id=?`,
      [companyId, id],
    )
    if (!r) throw notFound('Không tìm thấy WordPress job')
    return jobView(r)
  }
  jobs(companyId: string): WordpressJobView[] {
    return this.db
      .all<JobRow>(
        `SELECT ${JOB} FROM wordpress_jobs WHERE company_id=? ORDER BY created_at DESC,rowid DESC LIMIT 200`,
        [companyId],
      )
      .map(jobView)
  }
  claim(): WordpressJobView | undefined {
    return this.db.tx(() => {
      const r = this.db.get<JobRow>(
        `SELECT ${JOB} FROM wordpress_jobs WHERE status='queued' AND site_id NOT IN (SELECT site_id FROM wordpress_jobs WHERE status='running') ORDER BY created_at,rowid LIMIT 1`,
      )
      if (!r) return
      this.state(r.companyId, r.id, 'running')
      return this.job(r.companyId, r.id)
    })
  }
  state(
    companyId: string,
    id: string,
    status: string,
    result?: unknown,
    error?: string,
  ): void {
    this.db.run(
      'UPDATE wordpress_jobs SET status=?,result_json=COALESCE(?,result_json),error=?,updated_at=? WHERE company_id=? AND id=?',
      [
        status,
        result === undefined ? null : JSON.stringify(result),
        error ?? null,
        nowIso(),
        companyId,
        id,
      ],
    )
  }
  snapshot(companyId: string, id: string, value: unknown, hash?: string): void {
    this.db.run(
      'UPDATE wordpress_jobs SET snapshot_json=?,approval_hash=?,updated_at=? WHERE company_id=? AND id=?',
      [JSON.stringify(value), hash ?? null, nowIso(), companyId, id],
    )
  }
  approve(companyId: string, id: string, actorId: string, hash: string): void {
    this.manage(companyId, actorId)
    const j = this.job(companyId, id)
    if (
      j.status !== 'awaiting_approval' ||
      !j.approvalHash ||
      j.approvalHash !== hash
    )
      throw conflict('Yêu cầu duyệt không còn hợp lệ')
    this.db.run(
      "UPDATE wordpress_jobs SET approved_by=?,status='queued',updated_at=? WHERE company_id=? AND id=?",
      [actorId, nowIso(), companyId, id],
    )
    this.event(companyId, j.siteId, id, 'approved', { actorId })
  }
  event(
    companyId: string,
    siteId: string,
    jobId: string | null,
    action: string,
    details: unknown,
  ): void {
    this.db.run(
      'INSERT INTO wordpress_events(id,company_id,site_id,job_id,action,details_json,created_at) VALUES(?,?,?,?,?,?,?)',
      [
        newId(),
        companyId,
        siteId,
        jobId,
        action,
        JSON.stringify(details),
        nowIso(),
      ],
    )
  }
  events(companyId: string, siteId: string): unknown[] {
    this.site(companyId, siteId)
    return this.db.all(
      'SELECT id,job_id AS jobId,action,details_json AS details,created_at AS createdAt FROM wordpress_events WHERE company_id=? AND site_id=? ORDER BY created_at DESC LIMIT 200',
      [companyId, siteId],
    )
  }
  recover(): void {
    this.db.run(
      "UPDATE wordpress_jobs SET status='uncertain',error='Máy chủ khởi động lại; kiểm tra website trước khi tạo tác vụ mới',updated_at=? WHERE status='running'",
      [nowIso()],
    )
  }
}

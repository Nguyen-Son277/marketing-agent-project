import {
  conflict,
  forbidden,
  isBrowserUrlAllowed,
  newId,
  notFound,
  nowIso,
  validation,
  type BrowserAssetView,
  type BrowserChannelInput,
  type BrowserChannelView,
  type BrowserContentView,
  type BrowserDesktopView,
  type BrowserJobStatus,
  type BrowserJobView,
  type BrowserJobEvent,
} from '@marketing-agent/shared'
import type { Database } from '../database.ts'
import type { SecretBox } from '../crypto.ts'

const DESKTOP =
  'id, company_id AS companyId, name, endpoint, region, mode, active_job_id AS activeJobId, created_at AS createdAt'
const CHANNEL =
  'id, company_id AS companyId, desktop_id AS desktopId, name, platform, entry_url AS entryUrl, allowed_hosts_json AS hosts, instructions, can_post AS canPost, created_at AS createdAt'
const CONTENT = 'id, company_id AS companyId, title, body, created_at AS createdAt, updated_at AS updatedAt'
const ASSET =
  'id, company_id AS companyId, content_id AS contentId, filename, mime_type AS mimeType, size_bytes AS sizeBytes, created_at AS createdAt'
const JOB =
  'id, company_id AS companyId, channel_id AS channelId, content_id AS contentId, kind, status, instructions, result_url AS resultUrl, result, created_at AS createdAt, updated_at AS updatedAt'

export class SocialBrowserRepo {
  constructor(
    private readonly db: Database,
    private readonly secrets: SecretBox,
  ) {}

  manage(companyId: string, actorId: string | undefined): void {
    const member =
      actorId &&
      this.db.get<{ role: string }>('SELECT role FROM memberships WHERE company_id=? AND user_id=?', [
        companyId,
        actorId,
      ])
    if (!member || !['owner', 'admin'].includes(member.role))
      throw forbidden('Chỉ owner/admin được điều khiển trình duyệt đã đăng nhập')
  }

  desktops(companyId: string): BrowserDesktopView[] {
    return this.db.all(`SELECT ${DESKTOP} FROM browser_desktops WHERE company_id=? ORDER BY created_at,id`, [
      companyId,
    ])
  }
  desktop(companyId: string, id: string): BrowserDesktopView {
    const row = this.db.get<BrowserDesktopView>(
      `SELECT ${DESKTOP} FROM browser_desktops WHERE company_id=? AND id=?`,
      [companyId, id],
    )
    if (!row) throw notFound('Không tìm thấy môi trường trình duyệt')
    return row
  }
  createDesktop(
    companyId: string,
    input: { name: string; endpoint: string; token: string; region: string },
  ): BrowserDesktopView {
    const endpoint = new URL(input.endpoint).origin
    if (this.db.get('SELECT id FROM browser_desktops WHERE endpoint=?', [endpoint]))
      throw conflict('Mỗi worker chỉ được gắn với một môi trường và một công ty')
    const id = newId(),
      secret = this.secrets.encrypt(input.token)
    this.db.run(
      `INSERT INTO browser_desktops(id,company_id,name,endpoint,token_enc,token_iv,region,created_at) VALUES(?,?,?,?,?,?,?,?)`,
      [id, companyId, input.name, endpoint, secret.enc, secret.iv, input.region, nowIso()],
    )
    return this.desktop(companyId, id)
  }
  credentials(companyId: string, id: string): { endpoint: string; token: string } {
    this.desktop(companyId, id)
    const row = this.db.get<{ endpoint: string; enc: string; iv: string }>(
      'SELECT endpoint,token_enc AS enc,token_iv AS iv FROM browser_desktops WHERE company_id=? AND id=?',
      [companyId, id],
    )!
    return { endpoint: row.endpoint, token: this.secrets.decrypt(row.enc, row.iv) }
  }
  updateDesktop(
    companyId: string,
    id: string,
    input: { name: string; endpoint: string; region: string; token?: string },
  ): BrowserDesktopView {
    const desktop = this.desktop(companyId, id)
    if (desktop.activeJobId) throw conflict('Kết thúc tác vụ hiện tại trước khi sửa kết nối')
    const endpoint = new URL(input.endpoint).origin
    if (this.db.get('SELECT id FROM browser_desktops WHERE endpoint=? AND id<>?', [endpoint, id]))
      throw conflict('Worker đã được gắn với một môi trường')
    this.db.tx(() => {
      this.db.run(
        "UPDATE browser_desktops SET name=?,endpoint=?,region=?,mode='paused' WHERE company_id=? AND id=?",
        [input.name, endpoint, input.region, companyId, id],
      )
      if (input.token) {
        const secret = this.secrets.encrypt(input.token)
        this.db.run('UPDATE browser_desktops SET token_enc=?,token_iv=? WHERE company_id=? AND id=?', [
          secret.enc,
          secret.iv,
          companyId,
          id,
        ])
      }
    })
    return this.desktop(companyId, id)
  }
  setMode(companyId: string, id: string, mode: BrowserDesktopView['mode']): BrowserDesktopView {
    this.desktop(companyId, id)
    this.db.run('UPDATE browser_desktops SET mode=? WHERE company_id=? AND id=?', [mode, companyId, id])
    return this.desktop(companyId, id)
  }
  channels(companyId: string): BrowserChannelView[] {
    return this.db
      .all<
        BrowserChannelView & { hosts: string }
      >(`SELECT ${CHANNEL} FROM browser_channels WHERE company_id=? ORDER BY created_at,id`, [companyId])
      .map(({ hosts, ...row }) => ({
        ...row,
        allowedHosts: JSON.parse(hosts),
        canPost: Boolean(row.canPost),
      }))
  }
  channel(companyId: string, id: string): BrowserChannelView {
    const row = this.channels(companyId).find((c) => c.id === id)
    if (!row) throw notFound('Không tìm thấy kênh trình duyệt')
    return row
  }
  saveChannel(companyId: string, input: BrowserChannelInput, id = newId()): BrowserChannelView {
    this.desktop(companyId, input.desktopId)
    if (!isBrowserUrlAllowed(input.entryUrl, input.allowedHosts))
      throw validation('URL đích phải dùng HTTPS và nằm trong tên miền đã cho phép')
    const existing = this.db.get<{ companyId: string }>(
      'SELECT company_id AS companyId FROM browser_channels WHERE id=?',
      [id],
    )
    if (existing && existing.companyId !== companyId) throw notFound()
    if (
      this.db.get(
        "SELECT id FROM browser_jobs WHERE company_id=? AND channel_id=? AND status IN ('queued','running','waiting_human')",
        [companyId, id],
      )
    )
      throw conflict('Kênh đang có tác vụ, hãy kết thúc tác vụ trước khi sửa')
    this.db.run(
      `INSERT INTO browser_channels(id,company_id,desktop_id,name,platform,entry_url,allowed_hosts_json,instructions,can_post,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET desktop_id=excluded.desktop_id,name=excluded.name,platform=excluded.platform,
      entry_url=excluded.entry_url,allowed_hosts_json=excluded.allowed_hosts_json,instructions=excluded.instructions,can_post=excluded.can_post`,
      [
        id,
        companyId,
        input.desktopId,
        input.name,
        input.platform,
        input.entryUrl,
        JSON.stringify(input.allowedHosts),
        input.instructions,
        input.canPost ? 1 : 0,
        nowIso(),
      ],
    )
    return this.channel(companyId, id)
  }
  contents(companyId: string): BrowserContentView[] {
    return this.db
      .all<
        Omit<BrowserContentView, 'assets'>
      >(`SELECT ${CONTENT} FROM browser_contents WHERE company_id=? ORDER BY updated_at DESC,id LIMIT 200`, [companyId])
      .map((c) => ({ ...c, assets: this.assets(companyId, c.id) }))
  }
  content(companyId: string, id: string): BrowserContentView {
    const row = this.db.get<Omit<BrowserContentView, 'assets'>>(
      `SELECT ${CONTENT} FROM browser_contents WHERE company_id=? AND id=?`,
      [companyId, id],
    )
    if (!row) throw notFound('Không tìm thấy nội dung')
    return { ...row, assets: this.assets(companyId, id) }
  }
  saveContent(companyId: string, input: { title: string; body: string }, id = newId()): BrowserContentView {
    const existing = this.db.get<{ companyId: string }>(
      'SELECT company_id AS companyId FROM browser_contents WHERE id=?',
      [id],
    )
    if (existing && existing.companyId !== companyId) throw notFound()
    this.assertEditable(companyId, id)
    this.db.run(
      `INSERT INTO browser_contents(id,company_id,title,body,created_at,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at`,
      [id, companyId, input.title, input.body, nowIso(), nowIso()],
    )
    return this.content(companyId, id)
  }
  assertEditable(companyId: string, id: string): void {
    if (
      this.db.get(
        "SELECT id FROM browser_jobs WHERE company_id=? AND content_id=? AND status IN ('queued','running','waiting_human')",
        [companyId, id],
      )
    )
      throw conflict(
        'Nội dung đang gắn với tác vụ chưa kết thúc. Hãy tạo bản mới hoặc hủy tác vụ trước khi sửa.',
      )
  }
  assets(companyId: string, contentId: string): BrowserAssetView[] {
    return this.db.all(
      `SELECT ${ASSET} FROM browser_assets WHERE company_id=? AND content_id=? ORDER BY created_at,id`,
      [companyId, contentId],
    )
  }
  asset(companyId: string, id: string): BrowserAssetView {
    const row = this.db.get<BrowserAssetView>(
      `SELECT ${ASSET} FROM browser_assets WHERE company_id=? AND id=?`,
      [companyId, id],
    )
    if (!row) throw notFound('Không tìm thấy tệp nội dung')
    return row
  }
  addAsset(
    companyId: string,
    contentId: string,
    input: { id: string; filename: string; mimeType: string; sizeBytes: number },
  ): BrowserAssetView {
    this.content(companyId, contentId)
    this.assertEditable(companyId, contentId)
    this.db.run(
      'INSERT INTO browser_assets(id,company_id,content_id,filename,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,?,?)',
      [input.id, companyId, contentId, input.filename, input.mimeType, input.sizeBytes, nowIso()],
    )
    return this.asset(companyId, input.id)
  }
  removeAsset(companyId: string, id: string): void {
    const asset = this.asset(companyId, id)
    this.assertEditable(companyId, asset.contentId)
    this.db.run('DELETE FROM browser_assets WHERE company_id=? AND id=?', [companyId, id])
  }
  jobs(companyId: string): BrowserJobView[] {
    return this.db.all(
      `SELECT ${JOB} FROM browser_jobs WHERE company_id=? ORDER BY created_at DESC,id LIMIT 200`,
      [companyId],
    )
  }
  job(companyId: string, id: string): BrowserJobView {
    const row = this.db.get<BrowserJobView>(`SELECT ${JOB} FROM browser_jobs WHERE company_id=? AND id=?`, [
      companyId,
      id,
    ])
    if (!row) throw notFound('Không tìm thấy tác vụ trình duyệt')
    return row
  }
  createJob(
    companyId: string,
    actorId: string,
    input: {
      channelId: string
      contentId?: string
      kind: 'publish' | 'read'
      instructions: string
      idempotencyKey: string
    },
  ): BrowserJobView {
    this.manage(companyId, actorId)
    return this.db.tx(() => {
      const old = this.db.get<{ id: string }>(
        `SELECT id FROM browser_jobs WHERE company_id=? AND idempotency_key=?`,
        [companyId, input.idempotencyKey],
      )
      if (old) {
        const job = this.job(companyId, old.id)
        if (
          job.channelId !== input.channelId ||
          job.contentId !== (input.contentId ?? null) ||
          job.kind !== input.kind ||
          job.instructions !== input.instructions
        )
          throw conflict('Mã chống trùng đã dùng cho một tác vụ khác')
        return job
      }
      const channel = this.channel(companyId, input.channelId)
      if (input.kind === 'publish' && !channel.canPost) throw forbidden('Kênh này chỉ cho phép đọc thông tin')
      if (input.kind === 'publish' && !input.contentId) throw validation('Đăng bài cần nội dung')
      if (input.contentId) this.content(companyId, input.contentId)
      const id = newId()
      this.db.run(
        `INSERT INTO browser_jobs(id,company_id,channel_id,content_id,kind,instructions,idempotency_key,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          companyId,
          input.channelId,
          input.contentId ?? null,
          input.kind,
          input.instructions,
          input.idempotencyKey,
          actorId,
          nowIso(),
          nowIso(),
        ],
      )
      this.event(companyId, id, 'create', 'queued')
      return this.job(companyId, id)
    })
  }
  claim(companyId: string, id: string): BrowserJobView {
    return this.db.tx(() => {
      const job = this.job(companyId, id),
        channel = this.channel(companyId, job.channelId),
        desktop = this.desktop(companyId, channel.desktopId)
      if (job.status !== 'queued')
        throw conflict(
          'Tác vụ đã chạy. Không tự chạy lại để tránh đăng trùng; hãy kiểm tra kết quả và tạo tác vụ mới khi cần.',
        )
      if (desktop.mode !== 'agent')
        throw conflict('Hãy đăng nhập thủ công và chuyển môi trường sang chế độ agent')
      if (desktop.activeJobId) throw conflict('Môi trường đang có tác vụ khác')
      this.db.run('UPDATE browser_desktops SET active_job_id=? WHERE company_id=? AND id=?', [
        id,
        companyId,
        desktop.id,
      ])
      return this.setJob(companyId, id, 'running')
    })
  }
  setJob(
    companyId: string,
    id: string,
    status: BrowserJobStatus,
    result?: string,
    resultUrl?: string,
  ): BrowserJobView {
    this.job(companyId, id)
    this.db.run(
      'UPDATE browser_jobs SET status=?,result=COALESCE(?,result),result_url=COALESCE(?,result_url),updated_at=? WHERE company_id=? AND id=?',
      [status, result ?? null, resultUrl ?? null, nowIso(), companyId, id],
    )
    if (['succeeded', 'failed', 'cancelled'].includes(status))
      this.db.run('UPDATE browser_desktops SET active_job_id=NULL WHERE company_id=? AND active_job_id=?', [
        companyId,
        id,
      ])
    return this.job(companyId, id)
  }
  event(companyId: string, id: string, operation: string, outcome: string): void {
    this.job(companyId, id)
    this.db.run('INSERT INTO browser_job_events(id,job_id,operation,outcome,created_at) VALUES(?,?,?,?,?)', [
      newId(),
      id,
      operation,
      outcome,
      nowIso(),
    ])
  }
  events(companyId: string, id: string): BrowserJobEvent[] {
    this.job(companyId, id)
    return this.db.all(
      'SELECT id,job_id AS jobId,operation,outcome,created_at AS createdAt FROM browser_job_events WHERE job_id=? ORDER BY created_at,id',
      [id],
    )
  }
}

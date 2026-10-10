/** Users, memberships and auth sessions. The tenancy guard lives in `memberships`. */
import {
  conflict,
  newId,
  notFound,
  nowIso,
  sha256,
  unauthorized,
  type CompanyRole,
  type CompanyRecord,
  type MembershipRecord,
  type PublicUser,
  type UserRecord,
} from '@marketing-agent/shared'
import type { Database } from '../database.ts'
import { createSessionToken, hashPassword, verifyPassword } from '../password.ts'

interface UserRow {
  id: string
  email: string
  password_hash: string
  name: string
  is_admin: number
  created_at: string
}

interface SessionRow {
  id: string
  user_id: string
  token_hash: string
  created_at: string
  expires_at: string
  last_seen_at: string
}

interface CompanyRow {
  id: string
  name: string
  slug: string
  created_at: string
}

interface MembershipRow {
  id: string
  company_id: string
  user_id: string
  role: CompanyRole
  created_at: string
}

const toUser = (row: UserRow): UserRecord => ({
  id: row.id,
  email: row.email,
  passwordHash: row.password_hash,
  name: row.name,
  isAdmin: row.is_admin === 1,
  createdAt: row.created_at,
})

export const toPublicUser = (user: UserRecord): PublicUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  isAdmin: user.isAdmin,
})

const toCompany = (row: CompanyRow): CompanyRecord => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  createdAt: row.created_at,
})

const toMembership = (row: MembershipRow): MembershipRecord => ({
  id: row.id,
  companyId: row.company_id,
  userId: row.user_id,
  role: row.role,
  createdAt: row.created_at,
})

export class AuthRepo {
  constructor(private readonly db: Database) {}

  createUser(input: { email: string; password: string; name: string; isAdmin?: boolean }): UserRecord {
    const email = input.email.trim().toLowerCase()
    const existing = this.findUserByEmail(email)
    if (existing) throw conflict('Email này đã được đăng ký')
    const user: UserRecord = {
      id: newId(),
      email,
      passwordHash: hashPassword(input.password),
      name: input.name.trim(),
      isAdmin: input.isAdmin ?? false,
      createdAt: nowIso(),
    }
    this.db.run(
      `INSERT INTO users (id, email, password_hash, name, is_admin, created_at)
       VALUES (@id, @email, @passwordHash, @name, @isAdmin, @createdAt)`,
      { ...user, isAdmin: user.isAdmin ? 1 : 0 },
    )
    return user
  }

  findUserByEmail(email: string): UserRecord | undefined {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()])
    return row ? toUser(row) : undefined
  }

  findUserById(id: string): UserRecord | undefined {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id])
    return row ? toUser(row) : undefined
  }

  /** Verify credentials without revealing which half failed. */
  authenticate(email: string, password: string): UserRecord | undefined {
    const user = this.findUserByEmail(email)
    if (!user) return undefined
    if (!verifyPassword(password, user.passwordHash)) return undefined
    return user
  }

  /** Issue a session and return the plaintext token exactly once. */
  createSession(userId: string, ttlDays = 30): { token: string; expiresAt: string } {
    if (!this.findUserById(userId)) throw notFound('Không tìm thấy người dùng')
    const value = createSessionToken(ttlDays)
    this.db.run(
      `INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
       VALUES (@id, @userId, @tokenHash, @createdAt, @expiresAt, @createdAt)`,
      {
        id: value.sessionId,
        userId,
        tokenHash: value.tokenHash,
        createdAt: nowIso(),
        expiresAt: value.expiresAt,
      },
    )
    return { token: value.token, expiresAt: value.expiresAt }
  }

  /** Resolve a browser token to its user, sliding `last_seen_at` forward. */
  resolveSession(token: string): { user: UserRecord; sessionId: string } | undefined {
    const tokenHash = sha256(token)
    const row = this.db.get<SessionRow>('SELECT * FROM auth_sessions WHERE token_hash = ?', [tokenHash])
    if (!row) return undefined
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      this.db.run('DELETE FROM auth_sessions WHERE id = ?', [row.id])
      return undefined
    }
    const user = this.findUserById(row.user_id)
    if (!user) return undefined
    this.db.run('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?', [nowIso(), row.id])
    return { user, sessionId: row.id }
  }

  deleteSessionByToken(token: string): void {
    this.db.run('DELETE FROM auth_sessions WHERE token_hash = ?', [sha256(token)])
  }

  deleteSessionsForUser(userId: string): void {
    this.db.run('DELETE FROM auth_sessions WHERE user_id = ?', [userId])
  }

  purgeExpiredSessions(): number {
    const result = this.db.run('DELETE FROM auth_sessions WHERE expires_at <= ?', [nowIso()])
    return result.changes
  }

  /* ------------------------------------------------------------- companies */

  /** List companies the user belongs to, newest membership last. */
  listCompaniesForUser(userId: string): (CompanyRecord & { role: CompanyRole })[] {
    const rows = this.db.all<CompanyRow & { role: CompanyRole }>(
      `SELECT c.*, m.role AS role
         FROM memberships m
         JOIN companies c ON c.id = m.company_id
        WHERE m.user_id = ?
        ORDER BY c.created_at ASC, c.name ASC`,
      [userId],
    )
    return rows.map((row) => ({ ...toCompany(row), role: row.role }))
  }

  /** The tenancy guard: membership is the only way to reach a company. */
  membership(companyId: string, userId: string): MembershipRecord | undefined {
    const row = this.db.get<MembershipRow>(
      'SELECT * FROM memberships WHERE company_id = ? AND user_id = ?',
      [companyId, userId],
    )
    return row ? toMembership(row) : undefined
  }

  requireMembership(companyId: string, userId: string): MembershipRecord {
    const membership = this.membership(companyId, userId)
    if (!membership) throw notFound('Không tìm thấy công ty hoặc bạn không thuộc công ty này')
    return membership
  }

  addMembership(companyId: string, userId: string, role: CompanyRole): MembershipRecord {
    const existing = this.membership(companyId, userId)
    if (existing) return existing
    const record: MembershipRecord = { id: newId(), companyId, userId, role, createdAt: nowIso() }
    this.db.run(
      `INSERT INTO memberships (id, company_id, user_id, role, created_at)
       VALUES (@id, @companyId, @userId, @role, @createdAt)`,
      record,
    )
    return record
  }

  findCompanyBySlug(slug: string): CompanyRecord | undefined {
    const row = this.db.get<CompanyRow>('SELECT * FROM companies WHERE slug = ?', [slug])
    return row ? toCompany(row) : undefined
  }

  findCompanyById(id: string): CompanyRecord | undefined {
    const row = this.db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', [id])
    return row ? toCompany(row) : undefined
  }

  /**
   * Đổi tên hiển thị của công ty. Trả về bản ghi mới, hoặc `undefined` nếu không có.
   *
   * Cố ý KHÔNG nhận `slug`: slug là tên thư mục kho kiến thức trên đĩa và là khoá tra
   * cứu tài liệu đã index, nên đổi nó sẽ làm mồ côi toàn bộ tài liệu đang có. Tách tên
   * hiển thị khỏi đường dẫn là quyết định có chủ đích, không phải thiếu sót.
   */
  updateCompanyName(companyId: string, name: string): CompanyRecord | undefined {
    const trimmed = name.trim()
    if (trimmed.length === 0) return undefined
    this.db.run('UPDATE companies SET name = ? WHERE id = ?', [trimmed, companyId])
    return this.findCompanyById(companyId)
  }

  listMembers(companyId: string): (MembershipRecord & { user: PublicUser })[] {
    const rows = this.db.all<MembershipRow & { u_id: string; u_email: string; u_name: string; u_is_admin: number }>(
      `SELECT m.*, u.id AS u_id, u.email AS u_email, u.name AS u_name, u.is_admin AS u_is_admin
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.company_id = ?
        ORDER BY m.created_at ASC`,
      [companyId],
    )
    return rows.map((row) => ({
      ...toMembership(row),
      user: {
        id: row.u_id,
        email: row.u_email,
        name: row.u_name,
        isAdmin: row.u_is_admin === 1,
      },
    }))
  }

  /** Roles allowed to mutate company configuration. */
  static canManage(role: CompanyRole): boolean {
    return role === 'owner' || role === 'admin'
  }

  /** Roles allowed to start work (chat/tasks). Viewers are read-only. */
  static canWork(role: CompanyRole): boolean {
    return role !== 'viewer'
  }
}

export function requireUser(user: UserRecord | undefined): UserRecord {
  if (!user) throw unauthorized()
  return user
}

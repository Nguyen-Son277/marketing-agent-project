/** Nâng cấp không khoá tài khoản cũ và CLI không thay mật khẩu hay tự tạo admin. */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { createRepos } from '../src/index.ts'
import { MIGRATIONS } from '../src/migrations.ts'
import { grantAdmin } from '../../../scripts/grant-admin.ts'

describe('migration 0009', () => {
  it('giữ user cũ, hash, công ty và membership; user mới mặc định pending', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ma-approval-'))
    const file = join(dir, 'm.db')
    try {
      const legacy = new BetterSqlite3(file)
      legacy.exec('CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL, statements INTEGER NOT NULL)')
      for (const migration of MIGRATIONS.filter((m) => !m.id.startsWith('0009'))) {
        legacy.exec(migration.sql)
        legacy.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(migration.id, 'now', 1)
      }
      legacy.prepare('INSERT INTO users (id,email,password_hash,name,is_admin,created_at) VALUES (?,?,?,?,?,?)').run('old', 'old@example.com', 'old-hash', 'Old', 0, 'now')
      legacy.exec("INSERT INTO companies VALUES ('co','Old Company','old-company','now'); INSERT INTO memberships VALUES ('mem','co','old','owner','now')")
      legacy.close()
      const repos = createRepos({ file, allowWeakSecret: true })
      try {
        expect(repos.auth.findUserById('old')).toMatchObject({ approvalStatus: 'approved', passwordHash: 'old-hash', approvedAt: null, approvedBy: null })
        expect(repos.auth.membership('co', 'old')?.role).toBe('owner')
        expect(repos.auth.findCompanyById('co')?.slug).toBe('old-company')
        expect(repos.auth.createUser({ email: 'new@example.com', password: 'new-password-123', name: 'New' }).approvalStatus).toBe('pending')
      } finally { repos.db.close() }
      const again = createRepos({ file, allowWeakSecret: true })
      expect(again.auth.findUserById('old')?.approvalStatus).toBe('approved')
      again.db.close()
    } finally {
      // Chỉ dọn thư mục test vừa tạo, đã xác minh đường dẫn tuyệt đối.
      expect(realpathSync(dir)).toBe(resolve(dir))
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('grantAdmin dùng bởi CLI', () => {
  it('chỉ nâng email có thật, chạy lại an toàn và không đổi hash', () => {
    const repos = createRepos({ file: ':memory:', allowWeakSecret: true })
    try {
      expect(() => grantAdmin(repos, 'missing@example.com')).toThrow('chưa được đăng ký')
      expect(repos.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n).toBe(0)
      const user = repos.auth.createUser({ email: 'admin@example.com', password: 'admin-password-123', name: 'Admin' })
      const result = grantAdmin(repos, user.email)
      expect(result.user).toMatchObject({ isAdmin: true, approvalStatus: 'approved', passwordHash: user.passwordHash })
      expect(result.changed).toBe(true)
      expect(grantAdmin(repos, user.email).changed).toBe(false)
      expect(repos.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action='user.grant_admin'")?.n).toBe(1)
    } finally { repos.db.close() }
  })
})

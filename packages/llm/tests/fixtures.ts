/**
 * Dựng nhanh một workspace SQLite trong bộ nhớ cho test registry/router/cost.
 *
 * Vì sao dùng DB thật thay vì mock repo: các test này kiểm chứng đúng thứ dễ sai nhất
 * — thứ tự ưu tiên chọn model và quan hệ khoá ngoại của run — nên phải chạy trên schema
 * thật đã migrate.
 */
import { createRepos, type Repos } from '@marketing-agent/db'
import { nowIso } from '@marketing-agent/shared'

export function createTestRepos(): Repos {
  return createRepos({ file: ':memory:', allowWeakSecret: true })
}

export function createCompany(repos: Repos, id = 'c1'): string {
  repos.db.run('INSERT INTO companies (id, name, slug, created_at) VALUES (?, ?, ?, ?)', [
    id,
    `Công ty ${id}`,
    id,
    nowIso(),
  ])
  return id
}

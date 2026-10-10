/**
 * Test CLI `kb:index`: mở đúng database theo --database, tìm công ty theo slug,
 * index thư mục --root và ghi vào DB (kiểm chứng bằng cách mở lại file DB).
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRepos, type Repos } from '@marketing-agent/db'
import { seedCatalog, seedCompany } from '@marketing-agent/seed'
import { main } from '../src/cli/index-company.ts'
import { writeDocs } from './support.ts'

const DOCS = [
  { path: '00-cong-ty/tong-quan.md', content: '# Tổng quan công ty\n\nSapa Digital bán phần mềm quản lý bán hàng.\n' },
  { path: '10-brand/guidelines.md', content: '# Brand guidelines\n\n## Màu sắc\n\nMàu chính là xanh rêu #1B5E4A.\n' },
]

let rootDir: string
let companyId: string
let slug: string
let originalEmbeddingProvider: string | undefined
let originalAppSecret: string | undefined

beforeEach(() => {
  rootDir = mkdtempSync(join(process.cwd(), 'data', 'kb-cli-test-'))
  mkdirSync(join(rootDir, 'kb'), { recursive: true })
  writeDocs(join(rootDir, 'kb'), DOCS)

  const repos: Repos = createRepos({ file: join(rootDir, 'test.db'), allowWeakSecret: true })
  seedCatalog(repos)
  const seeded = seedCompany(repos, { companyName: 'CLI Test Company', withDemoKnowledge: false })
  companyId = seeded.company.id
  slug = seeded.company.slug
  repos.db.close()

  originalEmbeddingProvider = process.env.EMBEDDING_PROVIDER
  originalAppSecret = process.env.APP_SECRET
  process.env.EMBEDDING_PROVIDER = 'hash'
  process.env.APP_SECRET = 'chuoi-bi-mat-cho-test-cli-dai-hon-32-ky-tu'
})

afterEach(() => {
  restoreEnv('EMBEDDING_PROVIDER', originalEmbeddingProvider)
  restoreEnv('APP_SECRET', originalAppSecret)
  rmSync(rootDir, { recursive: true, force: true })
})

describe('CLI kb:index', () => {
  it('index thư mục --root vào database --database theo slug công ty', async () => {
    const code = await main([
      '--company',
      slug,
      '--database',
      join(rootDir, 'test.db'),
      '--root',
      join(rootDir, 'kb'),
    ])
    expect(code).toBe(0)

    const reopened = createRepos({ file: join(rootDir, 'test.db'), allowWeakSecret: true })
    const stats = reopened.knowledge.stats(companyId)
    expect(stats.documents).toBe(2)
    expect(stats.chunks).toBeGreaterThan(0)
    expect(stats.embedded).toBe(stats.chunks)
    reopened.db.close()
  })

  it('trả mã lỗi 1 khi thiếu --company', async () => {
    const code = await main(['--database', join(rootDir, 'test.db')])
    expect(code).toBe(1)
  })
})

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

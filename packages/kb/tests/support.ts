/**
 * Tiện ích dùng chung cho test gói kb: dựng repos in-memory, tạo thư mục tài
 * liệu tạm trong workspace (để không phụ thuộc thư mục hệ thống bị sandbox
 * chặn), và nạp bộ tài liệu demo thật của seed.
 *
 * Seed được import theo đường dẫn tương đối vì tsconfig của repo chưa khai báo
 * alias `@marketing-agent/seed` (chỉ vitest có alias), import tương đối giữ cho
 * cả `tsc -b` lẫn vitest đều hiểu.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRepos, type Repos } from '@marketing-agent/db'
import type { CompanyRecord } from '@marketing-agent/shared'
import { seedCatalog, seedCompany } from '@marketing-agent/seed'
import { DEMO_KB_DOCUMENTS } from '@marketing-agent/seed'
import { HashEmbeddingProvider } from '../src/embeddings.ts'

export const hashProvider = (): HashEmbeddingProvider => new HashEmbeddingProvider({ dim: 256 })

export interface KbFixture {
  readonly repos: Repos
  readonly company: CompanyRecord
  readonly rootDir: string
  readonly provider: HashEmbeddingProvider
  cleanup(): void
}

/** Repos in-memory + công ty đã cấu hình ACL/preset như seed thật. */
export function makeFixture(): KbFixture {
  const repos = createRepos({ file: ':memory:', allowWeakSecret: true })
  seedCatalog(repos)
  const { company } = seedCompany(repos, { companyName: 'Sapa Digital Test', withDemoKnowledge: false })
  mkdirSync(join(process.cwd(), 'data'), { recursive: true })
  const rootDir = mkdtempSync(join(process.cwd(), 'data', 'kb-test-'))
  return {
    repos,
    company,
    rootDir,
    provider: hashProvider(),
    cleanup() {
      repos.db.close()
      rmSync(rootDir, { recursive: true, force: true })
    },
  }
}

export interface FileDoc {
  readonly path: string
  readonly content: string
}

export function writeDocs(rootDir: string, docs: readonly FileDoc[]): void {
  for (const doc of docs) {
    const target = join(rootDir, ...doc.path.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, doc.content, 'utf8')
  }
}

/** Ghi 11 tài liệu demo tiếng Việt của seed ra đĩa để index thật. */
export function writeDemoDocs(rootDir: string): void {
  writeDocs(
    rootDir,
    DEMO_KB_DOCUMENTS.map((doc) => ({ path: doc.path, content: doc.content })),
  )
}

export { DEMO_KB_DOCUMENTS }

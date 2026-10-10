#!/usr/bin/env tsx
/**
 * `pnpm db:seed` — install the global catalog and optionally configure a company.
 *
 * Usage:
 *   pnpm db:seed                                    # catalog only
 *   pnpm db:seed --company "Công ty Demo" --demo     # + company, ACLs, demo KB
 *   pnpm db:seed --company Acme --email a@b.c --password 'matkhau12345'
 */
import { createRepos, resolveAppSecret } from '@marketing-agent/db'
import { seedCatalog, seedCompany } from '../src/index.ts'

interface Args {
  company?: string
  email?: string
  password?: string
  ownerName?: string
  demo: boolean
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { demo: false }
  const mutable = args as { company?: string; email?: string; password?: string; ownerName?: string; demo: boolean }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    const value = argv[i + 1]
    if (token === '--company' && value) {
      mutable.company = value
      i++
    } else if (token === '--email' && value) {
      mutable.email = value
      i++
    } else if (token === '--password' && value) {
      mutable.password = value
      i++
    } else if (token === '--owner-name' && value) {
      mutable.ownerName = value
      i++
    } else if (token === '--demo') {
      mutable.demo = true
    }
  }
  return args
}

/**
 * Nạp `.env` trước khi đọc biến môi trường.
 *
 * Vì sao bắt buộc: tài liệu quick-start nói làm theo thứ tự `cp .env.example .env`
 * rồi `pnpm db:seed`, nhưng nếu CLI không đọc `.env` thì lệnh đó luôn thất bại với
 * "Thiếu APP_SECRET" — người dùng phải tự export biến, điều hướng dẫn không hề nói.
 * Dùng `process.loadEnvFile` của Node 22 nên không cần thêm dependency dotenv.
 * Biến môi trường thật vẫn được ưu tiên: `loadEnvFile` không ghi đè biến đã có.
 */
function loadDotEnv(): void {
  const load = (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile
  if (typeof load !== 'function') return
  try {
    load()
  } catch {
    // .env là tuỳ chọn; biến môi trường thật vẫn dùng được.
  }
}

loadDotEnv()

const args = parseArgs(process.argv.slice(2))
const file = process.env.DATABASE_PATH ?? 'data/marketing.db'
const repos = createRepos({ file, appSecret: resolveAppSecret() })

try {
  const catalog = seedCatalog(repos)
  console.log(
    `✓ Catalog: ${catalog.agentDefs} định nghĩa agent · ${catalog.skills} kỹ năng · ` +
      `${catalog.providers} nhà cung cấp · ${catalog.models} model`,
  )

  if (args.company) {
    const result = seedCompany(repos, {
      companyName: args.company,
      ownerEmail: args.email,
      ownerPassword: args.password,
      ownerName: args.ownerName,
      withDemoKnowledge: args.demo,
      // Cùng gốc với `pnpm kb:index` và `config.kbRoot` của server, để tài liệu mẫu
      // nằm đúng chỗ mà indexer và agent đọc.
      ...(process.env.KB_ROOT ? { kbRoot: process.env.KB_ROOT } : {}),
    })
    console.log(
      `✓ Công ty "${result.company.name}" (${result.company.slug}): ` +
        `${result.presets} agent · ${result.routes} route model · ${result.aclEntries} quyền tri thức · ` +
        `${result.documents} tài liệu mẫu`,
    )
    if (result.owner) console.log(`  Chủ sở hữu: ${result.owner.email}`)
    if (result.documents > 0) {
      console.log('  Chạy `pnpm kb:index --company ' + result.company.slug + '` để tạo chỉ mục tìm kiếm.')
    }
  } else {
    console.log('  (Không có --company: chỉ cài catalog. Thêm --company "<tên>" --demo để tạo công ty mẫu.)')
  }
} finally {
  repos.db.close()
}

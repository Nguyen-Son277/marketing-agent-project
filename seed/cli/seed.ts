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

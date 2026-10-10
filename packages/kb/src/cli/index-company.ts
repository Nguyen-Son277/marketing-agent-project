/**
 * `pnpm kb:index --company <slug> [--force] [--watch]` — index kho kiến thức của
 * một công ty từ thư mục `data/companies/<slug>/kb`.
 *
 * Vì sao cần CLI riêng: index lần đầu và re-index sau khi marketing sửa file
 * Markdown là thao tác vận hành, không nên bắt buộc mở UI. `--watch` giữ tiến
 * trình sống và index lại sau mỗi lần lưu file để nội dung mới có mặt ngay trong
 * các phiên chat, còn checksum giúp lần chạy không đổi gần như miễn phí.
 */
import { existsSync, watch } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRepos, type Repos } from '@marketing-agent/db'
import { slugify } from '@marketing-agent/shared'
import { companyKbDir, indexCompany, type IndexCompanyResult } from '../indexer.ts'
import { createEmbeddingProvider } from '../embeddings.ts'

export interface CliOptions {
  company: string
  force: boolean
  watch: boolean
  root?: string
  databasePath: string
}

const USAGE = `Cách dùng: pnpm kb:index --company <slug> [--force] [--watch] [--root <thư-mục>] [--database <file>]

  --company <slug>   Slug công ty trong bảng companies (bắt buộc).
  --force            Index lại cả tài liệu không đổi.
  --watch            Theo dõi thư mục và index lại mỗi khi file .md thay đổi.
  --root <thư-mục>   Ghi đè thư mục KB (mặc định data/companies/<slug>/kb).
  --database <file>  Ghi đè DATABASE_PATH.

Biến môi trường: DATABASE_PATH, APP_SECRET, EMBEDDING_PROVIDER, EMBEDDING_MODEL, EMBEDDING_BASE_URL, EMBEDDING_API_KEY.`

export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const options: CliOptions = {
    company: '',
    force: false,
    watch: false,
    databasePath: env.DATABASE_PATH?.trim() || join('data', 'marketing.db'),
  }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? ''
    if (token === '--force') {
      options.force = true
      continue
    }
    if (token === '--watch') {
      options.watch = true
      continue
    }
    const equals = token.indexOf('=')
    const flag = equals >= 0 ? token.slice(0, equals) : token
    const inline = equals >= 0 ? token.slice(equals + 1) : undefined
    const takeValue = (): string | undefined => {
      if (inline !== undefined) return inline
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        i++
        return next
      }
      return undefined
    }
    if (flag === '--company') {
      const value = takeValue()
      if (!value) throw new Error('Thiếu giá trị cho --company')
      options.company = value.trim()
      continue
    }
    if (flag === '--root') {
      const value = takeValue()
      if (!value) throw new Error('Thiếu giá trị cho --root')
      options.root = resolve(value)
      continue
    }
    if (flag === '--database' || flag === '--db') {
      const value = takeValue()
      if (!value) throw new Error('Thiếu giá trị cho --database')
      options.databasePath = value
      continue
    }
    throw new Error(`Tham số không nhận diện được: ${token}`)
  }
  return options
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  loadDotEnv()
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE)
    return 0
  }

  let options: CliOptions
  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error(`[kb:index] ${errorMessage(error)}\n\n${USAGE}`)
    return 1
  }
  if (!options.company) {
    console.error(`[kb:index] Thiếu --company <slug>.\n\n${USAGE}`)
    return 1
  }

  let repos: Repos
  try {
    repos = createRepos({
      file: options.databasePath,
      ...(process.env.APP_SECRET ? { appSecret: process.env.APP_SECRET } : {}),
    })
  } catch (error) {
    console.error(`[kb:index] Không mở được cơ sở dữ liệu "${options.databasePath}": ${errorMessage(error)}`)
    console.error('Gợi ý: đặt DATABASE_PATH và APP_SECRET (tối thiểu 32 ký tự) trong .env hoặc biến môi trường.')
    return 1
  }

  try {
    const company = repos.auth.findCompanyBySlug(slugify(options.company)) ?? repos.auth.findCompanyBySlug(options.company)
    if (!company) {
      console.error(`[kb:index] Không tìm thấy công ty với slug "${slugify(options.company)}". Hãy chạy pnpm db:seed trước.`)
      repos.db.close()
      return 1
    }
    const rootDir = options.root ?? companyKbDir(company.slug)
    if (!existsSync(rootDir)) {
      console.error(`[kb:index] Không có thư mục kiến thức: ${rootDir}`)
      repos.db.close()
      return 1
    }

    const provider = await createEmbeddingProvider()
    console.log(`[kb:index] Công ty: ${company.name} (${company.slug})`)
    console.log(`[kb:index] Thư mục: ${rootDir}`)
    console.log(`[kb:index] Provider nhúng: ${provider.name}`)

    const run = async (): Promise<number> => {
      try {
        const result = await indexCompany(repos, {
          companyId: company.id,
          rootDir,
          provider,
          force: options.force,
        })
        printResult(result)
        return result.errors.length > 0 ? 1 : 0
      } catch (error) {
        console.error(`[kb:index] Lỗi khi index: ${errorMessage(error)}`)
        return 1
      }
    }

    if (!options.watch) {
      const code = await run()
      repos.db.close()
      return code
    }

    await run()
    startWatcher(rootDir, run)
    // Giữ tiến trình sống cho tới khi người dùng nhấn Ctrl+C.
    return new Promise<number>((resolvePromise) => {
      process.on('SIGINT', () => {
        console.log('\n[kb:index] Dừng theo dõi.')
        repos.db.close()
        resolvePromise(0)
      })
    })
  } catch (error) {
    console.error(`[kb:index] Lỗi: ${errorMessage(error)}`)
    repos.db.close()
    return 1
  }
}

function startWatcher(rootDir: string, run: () => Promise<number>): void {
  let timer: NodeJS.Timeout | null = null
  let running = false
  let pending = false

  const trigger = (): void => {
    if (running) {
      pending = true
      return
    }
    running = true
    void run().finally(() => {
      running = false
      if (pending) {
        pending = false
        trigger()
      }
    })
  }

  try {
    const watcher = watch(rootDir, { recursive: true }, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        trigger()
      }, 400)
    })
    watcher.on('error', (error) => console.error(`[kb:index] Lỗi theo dõi thư mục: ${errorMessage(error)}`))
  } catch (error) {
    console.error(`[kb:index] Không theo dõi được thư mục: ${errorMessage(error)}`)
  }
  console.log('[kb:index] Đang theo dõi thay đổi (Ctrl+C để dừng)...')
}

function printResult(result: IndexCompanyResult): void {
  console.log(`[kb:index] Đã index ${result.indexed}, bỏ qua ${result.skipped} (không đổi), tổng ${result.chunks} đoạn.`)
  if (result.errors.length > 0) {
    console.error(`[kb:index] ${result.errors.length} tài liệu lỗi:`)
    for (const item of result.errors.slice(0, 20)) console.error(`  - ${item.path}: ${item.message}`)
  }
}

/** Nạp .env bằng API có sẵn của Node 22 để CLI không cần thêm dependency dotenv. */
function loadDotEnv(): void {
  const load = (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile
  if (typeof load !== 'function') return
  try {
    load()
  } catch {
    // .env là tuỳ chọn; biến môi trường thật vẫn được ưu tiên.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const invoked = process.argv[1] ?? ''
if (invoked && (import.meta.url === pathToFileURL(invoked).href || /index-company\.(ts|js)$/.test(invoked))) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      console.error(`[kb:index] Lỗi không xử lý: ${errorMessage(error)}`)
      process.exitCode = 1
    })
}

#!/usr/bin/env tsx
/**
 * Cấp quyền admin chỉ từ shell server tin cậy; không có mật khẩu mặc định hay API tự cấp.
 * Phải đăng ký tài khoản trước. Lệnh không thay mật khẩu và không in bí mật.
 */
import { pathToFileURL } from 'node:url'
import { createRepos, resolveAppSecret } from '../packages/db/src/index.ts'

export function grantAdmin(repos: ReturnType<typeof createRepos>, email: string) {
  return repos.db.tx(() => {
    const result = repos.auth.grantSystemAdmin(email)
    if (result.changed) repos.accounting.audit({ userId: result.user.id, action: 'user.grant_admin', target: result.user.id })
    return result
  })
}

export function runGrantAdmin(args: readonly string[]): void {
  try { process.loadEnvFile() } catch { /* .env là tuỳ chọn, biến thật vẫn có hiệu lực. */ }
  if (args.length !== 2 || args[0] !== '--email' || !args[1]?.includes('@')) {
    throw new Error('Cách dùng: pnpm admin:grant --email <email-đã-đăng-ký>')
  }
  const repos = createRepos({ file: process.env.DATABASE_PATH ?? 'data/marketing.db', appSecret: resolveAppSecret() })
  try {
    const result = grantAdmin(repos, args[1])
    console.log(result.changed ? `Đã cấp quyền admin cho ${result.user.email}.` : `${result.user.email} đã là admin.`)
  } finally { repos.db.close() }
}

// Không chạy CLI khi test import hàm; so đường dẫn để tránh tác dụng phụ ngoài ý muốn.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { runGrantAdmin(process.argv.slice(2)) }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}

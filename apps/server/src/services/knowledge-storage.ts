import { mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { notFound, validation } from '@marketing-agent/shared'

/** Originals are private, outside the legacy Markdown scanner, never served statically. */
export function uploadStoragePath(kbRoot: string, companyId: string, key: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(companyId) || !/^[a-f0-9-]{36}$/.test(key)) {
    throw validation('Khóa lưu trữ tài liệu không hợp lệ')
  }
  const root = resolve(kbRoot, '.uploads', companyId)
  const target = resolve(root, key)
  if (dirname(target) !== root) throw validation('Đường dẫn tài liệu không hợp lệ')
  return target
}

export async function storeKnowledgeOriginal(kbRoot: string, companyId: string, bytes: Buffer): Promise<string> {
  const key = randomUUID()
  const target = uploadStoragePath(kbRoot, companyId, key)
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  const actualParent = await realpath(dirname(target))
  if (actualParent !== dirname(target)) throw validation('Thư mục lưu trữ không được là liên kết tượng trưng')
  await writeFile(target, bytes, { flag: 'wx', mode: 0o600 })
  return key
}

export async function readKnowledgeOriginal(kbRoot: string, companyId: string, key: string): Promise<Buffer> {
  const target = uploadStoragePath(kbRoot, companyId, key)
  await verifyRealPath(dirname(target), target)
  try { return await readFile(target) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw notFound('Không tìm thấy file gốc của tài liệu')
    throw error
  }
}

export async function removeKnowledgeOriginal(kbRoot: string, companyId: string, key: string): Promise<void> {
  const target = uploadStoragePath(kbRoot, companyId, key)
  await removeWithinRoot(dirname(target), target)
}

/** Resolve and verify both lexical and real paths before deleting a managed source. */
export async function removeLegacyKnowledgeFile(root: string, path: string): Promise<void> {
  const absoluteRoot = resolve(root)
  const target = resolve(absoluteRoot, path)
  const rel = relative(absoluteRoot, target)
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || !target.toLowerCase().endsWith('.md')) {
    throw validation('Đường dẫn nguồn kiến thức không an toàn')
  }
  await removeWithinRoot(absoluteRoot, target)
}

async function verifyRealPath(root: string, target: string): Promise<void> {
  if (dirname(target) === root && root.includes(`${sep}.uploads${sep}`)) {
    try {
      if (await realpath(root) !== root) throw validation('Thư mục lưu trữ không được là liên kết tượng trưng')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  try {
    const [actualRoot, actualTarget] = await Promise.all([realpath(root), realpath(target)])
    const rel = relative(actualRoot, actualTarget)
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
      throw validation('Đường dẫn nguồn kiến thức nằm ngoài vùng lưu trữ')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

async function removeWithinRoot(root: string, target: string): Promise<void> {
  await verifyRealPath(root, target)
  try { await unlink(target) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

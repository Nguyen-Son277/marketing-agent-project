import { mkdtemp, mkdir, readFile, symlink, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readKnowledgeOriginal, removeKnowledgeOriginal, removeLegacyKnowledgeFile, storeKnowledgeOriginal, uploadStoragePath } from '../src/services/knowledge-storage.ts'

describe('private knowledge storage', () => {
  it('stores original bytes per company and safely removes them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-storage-'))
    try {
      const bytes = Buffer.from('Tài liệu bí mật')
      const key = await storeKnowledgeOriginal(root, 'company-a', bytes)
      expect(await readKnowledgeOriginal(root, 'company-a', key)).toEqual(bytes)
      await expect(readKnowledgeOriginal(root, 'company-b', key)).rejects.toThrow()
      expect(() => uploadStoragePath(root, '../escape', key)).toThrow()
      expect(() => uploadStoragePath(root, 'company-a', '../escape')).toThrow()
      await removeKnowledgeOriginal(root, 'company-a', key)
      await expect(readKnowledgeOriginal(root, 'company-a', key)).rejects.toThrow()
    } finally { await rm(root, {recursive:true,force:true}) }
  })
  it('refuses traversal or symlinks outside the legacy root before deleting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kb-storage-'))
    try {
      const kb = join(root, 'kb')
      await mkdir(kb)
      await writeFile(join(root,'keep.md'),'keep')
      await symlink(join(root,'keep.md'),join(kb,'linked.md'))
      await expect(removeLegacyKnowledgeFile(kb,'../keep.md')).rejects.toThrow()
      await expect(removeLegacyKnowledgeFile(kb,'linked.md')).rejects.toThrow()
      expect(await readFile(join(root,'keep.md'),'utf8')).toBe('keep')
      await writeFile(join(kb,'delete.md'),'delete')
      await removeLegacyKnowledgeFile(kb,'delete.md')
      await expect(readFile(join(kb,'delete.md'))).rejects.toThrow()
    } finally { await rm(root,{recursive:true,force:true}) }
  })
})

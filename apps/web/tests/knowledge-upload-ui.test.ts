import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('knowledge file-first uploads', () => {
  const screen = read('../src/screens/KhoKienThuc.tsx')
  const api = read('../src/lib/api.ts')

  it('limits queue, accepted extensions and per-file size, with sequential retryable status', () => {
    expect(screen).toContain('MAX_UPLOAD_FILES = 10')
    expect(screen).toContain('MAX_UPLOAD_BYTES = 10 * 1024 * 1024')
    expect(screen).toContain("new Set(['pdf', 'docx', 'txt', 'md'])")
    expect(screen).toContain('for (const item of tepCho)')
    expect(screen).toContain("status: 'error'")
    expect(screen).toContain('retryUpload(item.id)')
    expect(screen).toContain('onDrop=')
  })

  it('uses file-only multipart upload and exposes classification/detail endpoints', () => {
    expect(api).toContain('async uploadKnowledge(')
    expect(api).toContain('form.append("file", input.file)')
    expect(api).toContain('if (input.category) form.append')
    expect(api).toContain('if (input.tags) form.append')
    expect(api).toContain('classification/retry')
    expect(api).toContain('/sections/${encodeURIComponent(sectionId)}')
    expect(api).toContain('options.body === undefined || isFormData')
    expect(api).toContain("/api/companies/${encodeURIComponent(companyId)}/knowledge/${encodeURIComponent(documentId)}/download")
    expect(api).toContain("/api/companies/${encodeURIComponent(companyId)}/knowledge/${encodeURIComponent(documentId)}")
  })

  it('uses a prominent real button to open the native file picker', () => {
    const css = read('../src/styles.css')
    expect(screen).toContain('<Nut className="knowledge__choose-files"')
    expect(screen).toContain('onClick={() => fileInputRef.current?.click()}')
    expect(screen).toContain('ref={fileInputRef} type="file"')
    expect(screen).not.toContain('className="nut nut--phu"')
    expect(css).toContain('.knowledge__choose-files:focus-visible')
    expect(css).toContain('min-height: 52px')
  })

  it('keeps uploaded body read-only while metadata can be saved', () => {
    expect(screen).toContain('value={noiDungTaiLen ?? \'\'} readOnly')
    expect(screen).toContain('luuMetadata()')
    expect(screen).toContain('selectionEpoch.current')
  })

  it('distinguishes classification failures, pending documents, and ready lexical-only documents', () => {
    expect(api).toContain('chunkCount?: number')
    expect(api).toContain('classificationNextAttemptAt?: string | null')
    expect(api).toContain('async retryFailedKnowledge(')
    expect(screen).toContain('knowledge.noSearchableData')
    expect(screen).toContain('knowledge.processingNoSearch')
    expect(screen).toContain('knowledge.retryBackoff')
    expect(screen).toContain('knowledge.retryFailed')
    expect(screen).toContain('doc.classificationStatus === \'failed\'')
    expect(screen).toContain('(doc.chunkCount ?? 0) > 0')
    expect(screen).toContain('knowledge.reindexClassificationResult')
    expect(screen).not.toContain('knowledge.missingEmbeddings')
  })

  it('has translated queue and upload UI strings in Vietnamese and English', () => {
    for (const locale of ['vi', 'en']) {
      const catalog = read(`../../../packages/i18n/src/catalogs/${locale}/knowledge.ts`)
      for (const key of ['uploadTitle', 'uploadHint', 'chooseFiles', 'dropFiles', 'uploadButton', 'uploadFailed', 'downloadOriginal']) {
        expect(catalog).toContain(`knowledge.${key}`)
      }
    }
  })
})

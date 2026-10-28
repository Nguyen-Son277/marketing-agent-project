import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { useOptionalSession } from '../src/lib/session.tsx'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('knowledge product images per company UI', () => {
  const screen = read('../src/screens/KhoKienThuc.tsx')
  const css = read('../src/styles.css')
  const session = read('../src/lib/session.tsx')

  it('exposes company switching and active company identification', () => {
    expect(screen).toContain('useOptionalSession')
    expect(screen).toContain('className="knowledge-company-bar"')
    expect(screen).toContain('knowledge.activeCompany')
    expect(screen).toContain('knowledge.switchCompany')
    expect(screen).toContain('session.selectCompany')
    expect(session).toContain('export function useOptionalSession')
  })

  it('provides dedicated tabs for knowledge documents and product images', () => {
    expect(screen).toContain("cheDoXem === 'tai-lieu'")
    expect(screen).toContain("cheDoXem === 'anh-san-pham'")
    expect(screen).toContain('knowledge.tabDocuments')
    expect(screen).toContain('knowledge.tabProductImages')
    expect(screen).toContain('knowledge-tabs')
    expect(css).toContain('.knowledge-tabs')
    expect(css).toContain('.knowledge-company-bar')
  })

  it('provides dedicated product image upload area with labeled metadata fields and previews', () => {
    expect(screen).toContain('knowledge.productImageUploadTitle')
    expect(screen).toContain('knowledge.productImageUploadHint')
    expect(screen).toContain('knowledge.imageProductName')
    expect(screen).toContain('knowledge.imageBrandName')
    expect(screen).toContain('knowledge.imageTags')
    expect(screen).toContain('knowledge.imageDescription')
    expect(screen).toContain('knowledge__choose-product-files')
    expect(screen).toContain('ref={imageFileInputRef}')
    expect(screen).toContain('type="file"')
    expect(screen).toContain('knowledge.dropProductImages')
    expect(screen).toContain('knowledge.previewThumbnails')
    expect(screen).toContain('className="knowledge-queue-thumb"')
    expect(css).toContain('.knowledge__choose-product-files')
    expect(css).toContain('.knowledge-queue-thumb')
  })

  it('provides product image gallery with search, thumbnails, AI analysis status and actions', () => {
    expect(screen).toContain('knowledge.productImageGalleryTitle')
    expect(screen).toContain('knowledge.searchProductImagesPlaceholder')
    expect(screen).toContain('knowledge.noProductImages')
    expect(screen).toContain('className="knowledge-image-grid"')
    expect(screen).toContain('knowledge-image-card')
    expect(screen).toContain('api.knowledgeImageUrl(companyId, taiLieu.id)')
    expect(screen).toContain('api.retryKnowledgeImageAnalysis')
    expect(screen).toContain('knowledge.editProductImage')
    expect(css).toContain('.knowledge-image-grid')
    expect(css).toContain('.knowledge-image-card')
  })

  it('has translated product image UI strings in Vietnamese and English catalogs', () => {
    const requiredKeys = [
      'tabDocuments',
      'tabProductImages',
      'activeCompany',
      'switchCompany',
      'productImageUploadTitle',
      'productImageUploadHint',
      'imageProductName',
      'imageBrandName',
      'imageTags',
      'imageDescription',
      'chooseProductImages',
      'dropProductImages',
      'productImageGalleryTitle',
      'productImageGalleryHint',
      'productImagesCount',
      'searchProductImagesPlaceholder',
      'noProductImages',
      'previewThumbnails',
      'switchToProductImages',
    ]
    for (const locale of ['vi', 'en']) {
      const catalog = read(`../../../packages/i18n/src/catalogs/${locale}/knowledge.ts`)
      for (const key of requiredKeys) {
        expect(catalog, `${locale} missing knowledge.${key}`).toContain(`'knowledge.${key}'`)
      }
    }
  })

  it('returns undefined from useOptionalSession outside SessionProvider without throwing', () => {
    let captured: unknown = 'init'
    function TestComponent() {
      captured = useOptionalSession()
      return createElement('div', null, 'ok')
    }
    expect(() => renderToStaticMarkup(createElement(TestComponent))).not.toThrow()
    expect(captured).toBeUndefined()
  })
})

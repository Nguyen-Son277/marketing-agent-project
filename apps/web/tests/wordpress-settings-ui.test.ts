import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SETTINGS_TABS } from '../src/lib/settings-tabs.ts'

const doc = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const wpSettings = doc('../src/components/WordpressSettings.tsx')
const wpScreen = doc('../src/screens/Wordpress.tsx')
const caiDat = doc('../src/screens/CaiDat.tsx')
const vi = doc('../../../packages/i18n/src/catalogs/vi/settings.ts')
const en = doc('../../../packages/i18n/src/catalogs/en/settings.ts')

describe('WordPress settings UI invariants', () => {
  it('tab WordPress được đăng ký trong SETTINGS_TABS', () => {
    const tab = SETTINGS_TABS.find((t) => t.id === 'wordpress')
    expect(tab).toBeDefined()
    expect(tab?.label).toBe('settings.tabs.wordpress')
  })

  it('CaiDat gắn panel wordpress dùng WordpressSettings', () => {
    expect(caiDat).toContain('import { WordpressSettings } from "../components/WordpressSettings.tsx"')
    expect(caiDat).toMatch(/wordpress:\s*<WordpressSettings\s+companyId=\{companyId\}\s*\/>/)
  })

  it('WordpressSettings dùng HopThoai cho biểu mẫu thêm và sửa kết nối', () => {
    expect(wpSettings).toContain('import { HopThoai, HopThoaiXacNhan } from \'./HopThoai.tsx\'')
    expect(wpSettings).toMatch(/<HopThoai\s+mo=\{hopThoaiMo\}/)
    expect(wpSettings).not.toContain('window.confirm(')
    expect(wpSettings).not.toContain('window.alert(')
  })

  it('WordpressSettings dùng HopThoaiXacNhan cho việc thu hồi kết nối', () => {
    expect(wpSettings).toMatch(/<HopThoaiXacNhan\s+mo=\{Boolean\(siteChoXoa\)\}/)
  })

  it('WordpressSettings có liên kết điều hướng tới workspace WordPress', () => {
    expect(wpSettings).toContain('#/wordpress?siteId=')
  })

  it('màn hình WordPress có liên kết chuyển nhanh sang tab cài đặt', () => {
    expect(wpScreen).toContain('#/cai-dat?tab=wordpress')
    expect(wpScreen).not.toContain('window.confirm(')
  })

  it('i18n vi và en có đầy đủ các khoá của tab wordpress', () => {
    for (const catalog of [vi, en]) {
      expect(catalog).toContain('\'settings.tabs.wordpress\'')
      expect(catalog).toContain('\'settings.wordpress.title\'')
      expect(catalog).toContain('\'settings.wordpress.add\'')
      expect(catalog).toContain('\'settings.wordpress.test\'')
      expect(catalog).toContain('\'settings.wordpress.revoke\'')
      expect(catalog).toContain('\'settings.wordpress.form.siteName\'')
      expect(catalog).toContain('\'settings.wordpress.form.password\'')
    }
  })
})

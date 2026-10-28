import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const doc = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const caiDat = doc('../src/screens/CaiDat.tsx')
const vi = doc('../../../packages/i18n/src/catalogs/vi/settings.ts')
const en = doc('../../../packages/i18n/src/catalogs/en/settings.ts')

describe('Cost limits UI (PhanGioiHan) unlimit features', () => {
  it('PhanGioiHan có nút unlimit chi phí và khôi phục hạn mức mặc định', () => {
    expect(caiDat).toContain('toggleUnlimitCost')
    expect(caiDat).toContain('settings.limits.unlimitCosts')
    expect(caiDat).toContain('settings.limits.restoreDefaultCost')
  })

  it('PhanGioiHan có nút chuyển nhanh unlimit cho từng ô chi phí', () => {
    expect(caiDat).toContain('toggleUnlimitDailyCost')
    expect(caiDat).toContain('toggleUnlimitTaskCost')
    expect(caiDat).toContain('settings.limits.unlimit')
    expect(caiDat).toContain('settings.limits.restoreDefault')
  })

  it('PhanGioiHan hiển thị nhãn và gợi ý không giới hạn khi giá trị là 0', () => {
    expect(caiDat).toContain('settings.limits.unlimitedBadge')
    expect(caiDat).toContain('settings.limits.zeroForUnlimitedHint')
    expect(caiDat).toContain('soTuChuoi(duLieu.dailyCostUsd) === 0')
    expect(caiDat).toContain('soTuChuoi(duLieu.taskCostUsd) === 0')
  })

  it('vùng tổng chi phí 24h hiển thị không giới hạn thay vì trần $0.00 khi tran = 0', () => {
    expect(caiDat).toMatch(/tran > 0 \?\s*\(\s*<>\s*\{t\("settings\.limits\.limitPrefix"\)\}/)
    expect(caiDat).toMatch(/t\("settings\.limits\.unlimitedBadge"\)/)
  })

  it('catalog i18n vi và en có đầy đủ các khoá của tính năng unlimit chi phí', () => {
    const requiredKeys = [
      'settings.limits.unlimitCosts',
      'settings.limits.restoreDefaultCost',
      'settings.limits.unlimit',
      'settings.limits.restoreDefault',
      'settings.limits.zeroForUnlimitedHint',
      'settings.limits.unlimitedBadge',
    ]

    for (const catalog of [vi, en]) {
      for (const key of requiredKeys) {
        expect(catalog).toContain(`'${key}'`)
      }
    }
  })
})

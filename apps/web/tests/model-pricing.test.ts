import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseModelPricing } from '../src/lib/model-pricing.ts'
import { updateModelSchema } from '@marketing-agent/shared'

describe('model pricing', () => {
  it('accepts explicit zero and preserves tiny decimals', () => {
    expect(parseModelPricing('0', '0')).toEqual({ costInPerMtok: 0, costOutPerMtok: 0 })
    expect(parseModelPricing('0.00000001', '1e-8')).toEqual({ costInPerMtok: 1e-8, costOutPerMtok: 1e-8 })
    expect(parseModelPricing(' .025 ', '2.5')).toEqual({ costInPerMtok: 0.025, costOutPerMtok: 2.5 })
  })
  it('rejects missing, negative, non-finite and malformed values', () => {
    for (const value of ['', ' ', '-1', 'NaN', 'Infinity', '1e999', '0,25', 'abc', '0x10']) {
      expect(parseModelPricing(value, '1')).toBeNull()
      expect(parseModelPricing('1', value)).toBeNull()
    }
    for (const value of [-1, NaN, Infinity, -Infinity]) {
      expect(updateModelSchema.safeParse({ costInPerMtok: value }).success).toBe(false)
    }
  })
  it('uses a separate dialog, price-only API and an explicit reset confirmation', () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
    const dialog = read('../src/components/ModelPricingDialog.tsx')
    const screen = read('../src/screens/CaiDat.tsx')
    expect(screen).toContain('<ModelPricingDialog')
    expect(screen).toContain('suaGia?.companyId === companyId')
    expect(dialog).toContain('<HopThoaiXacNhan')
    expect(dialog).toContain('costInPerMtok: 0, costOutPerMtok: 0')
    expect(dialog).toContain('api.updateModelPricing(companyId, model.id, prices)')
    expect(dialog).toContain('if (lock.current) return')
    expect(dialog).toContain('pricing.input')
    expect(dialog).toContain('pricing.output')
    expect(dialog).not.toContain('api.deleteModel')
  })
})

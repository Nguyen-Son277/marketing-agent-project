/**
 * Test `CostMeter`: số học chi phí và ngân sách.
 *
 * Trọng tâm: chi phí cộng dồn qua nhiều bước phải khớp `computeCostUsd`, và vượt hạn
 * mức phải ném đúng `budget_exceeded` trước khi tiêu thêm tiền.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError, type LlmModelRecord } from '@marketing-agent/shared'
import { computeCostUsd, type Repos } from '@marketing-agent/db'
import { CostMeter, startOfUtcDayIso } from '../src/cost.ts'
import { createCompany, createTestRepos } from './fixtures.ts'

let repos: Repos
let model: LlmModelRecord
let meter: CostMeter

beforeEach(() => {
  repos = createTestRepos()
  createCompany(repos, 'c1')
  const provider = repos.llm.createProvider({
    companyId: null,
    name: 'Gateway',
    kind: 'openai_compatible',
    baseUrl: 'http://localhost:20128/v1',
    apiKeyRef: 'TEST_KEY',
  })
  model = repos.llm.createModel({
    providerId: provider.id,
    modelId: 'priced',
    label: 'Priced model',
    costInPerMtok: 3,
    costOutPerMtok: 15,
  })
  meter = new CostMeter(repos.accounting)
})

afterEach(() => {
  repos.db.close()
})

describe('CostMeter', () => {
  it('cộng dồn usage qua nhiều bước và khớp computeCostUsd', () => {
    const runId = meter.open({ companyId: 'c1', agentDefId: 'def-1' })
    expect(runId).toBeTruthy()

    meter.addUsage(model, { promptTokens: 1000, completionTokens: 500, cachedTokens: 0 })
    meter.addUsage(model, { promptTokens: 2000, completionTokens: 1000, cachedTokens: 100 })

    const snapshot = meter.snapshot()
    expect(snapshot.tokensIn).toBe(3000)
    expect(snapshot.tokensOut).toBe(1500)
    expect(snapshot.cachedTokens).toBe(100)
    expect(snapshot.calls).toBe(2)
    expect(snapshot.costUsd).toBe(computeCostUsd(model, 3000, 1500))
    expect(snapshot.costUsd).toBeCloseTo(0.0315, 6)
  })

  it('đóng run ghi đúng bản ghi và rollup usage ngày', () => {
    meter.open({ companyId: 'c1', agentDefId: 'def-1' })
    meter.addUsage(model, { promptTokens: 1000, completionTokens: 500, cachedTokens: 0 })
    const record = meter.finish({ status: 'succeeded', steps: 3, latencyMs: 120 })

    expect(record.status).toBe('succeeded')
    expect(record.tokensIn).toBe(1000)
    expect(record.tokensOut).toBe(500)
    expect(record.costUsd).toBe(computeCostUsd(model, 1000, 500))
    expect(record.steps).toBe(3)
    expect(record.latencyMs).toBe(120)

    const usage = repos.accounting.usageSince('c1', startOfUtcDayIso())
    expect(usage.costUsd).toBe(record.costUsd)
    expect(usage.runs).toBe(1)
  })

  it('vượt hạn mức ngày thì ném budget_exceeded', () => {
    meter.open({ companyId: 'c1', agentDefId: 'def-1' })
    meter.addUsage(model, { promptTokens: 100_000, completionTokens: 50_000, cachedTokens: 0 })

    const error = (() => {
      try {
        meter.checkBudget('c1', { dailyCostUsd: 0.01 })
        return null
      } catch (thrown) {
        return thrown
      }
    })()

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('budget_exceeded')
    expect(meter.checkBudget('c1', { dailyCostUsd: 100 }).allowed).toBe(true)
  })

  it('vượt hạn mức cho một việc thì ném budget_exceeded dù còn hạn mức ngày', () => {
    meter.open({ companyId: 'c1', agentDefId: 'def-1' })
    meter.addUsage(model, { promptTokens: 1000, completionTokens: 500, cachedTokens: 0 })

    expect(() => meter.checkBudget('c1', { dailyCostUsd: 100, taskCostUsd: 0.001 })).toThrow(AppError)
    const status = meter.checkBudget('c1', { dailyCostUsd: 100, taskCostUsd: 1 })
    expect(status.remainingTaskUsd).toBeCloseTo(1 - status.spentThisRunUsd, 6)
  })

  it('tính cả chi phí đã ghi trong ngày của các run trước', () => {
    const first = new CostMeter(repos.accounting)
    first.open({ companyId: 'c1', agentDefId: 'def-1' })
    first.addUsage(model, { promptTokens: 10_000, completionTokens: 10_000, cachedTokens: 0 })
    first.finish({ status: 'succeeded', steps: 1 })

    const second = new CostMeter(repos.accounting)
    second.open({ companyId: 'c1', agentDefId: 'def-1' })
    second.addUsage(model, { promptTokens: 10_000, completionTokens: 10_000, cachedTokens: 0 })

    const error = (() => {
      try {
        second.checkBudget('c1', { dailyCostUsd: 0.2 })
        return null
      } catch (thrown) {
        return thrown
      }
    })()
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('budget_exceeded')
  })
})

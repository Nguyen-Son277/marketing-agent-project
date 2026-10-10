/**
 * Regression test for reasoning-model runs.
 *
 * A reasoning model can spend its entire output budget on hidden reasoning and
 * emit no answer text. That case was previously indistinguishable from a
 * successful empty answer, so the user received nothing with no explanation.
 * These tests pin the corrected behaviour: the reasoning is surfaced and the run
 * is reported as hitting the output limit.
 */
import { describe, expect, it } from 'vitest'
import type { LlmChunk, LlmUsage } from '@marketing-agent/shared'
import { runAgent } from '../src/index.ts'
import type { AdapterResolver, AgentRuntimeDeps } from '../src/types.ts'
import {
  buildResolvedAgent,
  fakeMeter,
  fakeRouter,
  scriptedAdapter,
  testContext,
  usage,
  type ScriptedAdapter,
} from './fixtures.ts'

function depsFor(adapter: ScriptedAdapter): AgentRuntimeDeps {
  const adapters: AdapterResolver = {
    adapterFor: () => {
      throw new Error('không được gọi adapterFor khi test đã truyền adapter cố định')
    },
  }
  return { router: fakeRouter(), adapters, meterFactory: fakeMeter().factory, adapter }
}

/** A turn that emits hidden reasoning only, then stops normally. */
function reasoningOnly(text: string, tokens: LlmUsage = usage(50, 40)): { chunks: readonly LlmChunk[] } {
  return {
    chunks: [
      { type: 'reasoning', text },
      { type: 'done', finishReason: 'stop', usage: tokens },
    ],
  }
}

const input = () => ({
  agent: buildResolvedAgent(),
  context: testContext(),
  messages: [{ role: 'user' as const, content: 'Phân tích KPI tháng này' }],
  tools: [],
})

describe('reasoning-model runs', () => {
  it('never returns empty output when the model reasoned but did not answer', async () => {
    const adapter = scriptedAdapter([reasoningOnly('Cần cân nhắc giữa hai cách tính chỉ số...')])
    const result = await runAgent(input(), depsFor(adapter))

    expect(result.output.trim().length).toBeGreaterThan(0)
    expect(result.output).toContain('Cần cân nhắc giữa hai cách tính chỉ số')
    expect(result.reasoningText).toContain('Cần cân nhắc')
  })

  it('reports output_limit rather than success for a reasoning-only turn', async () => {
    const adapter = scriptedAdapter([reasoningOnly('Suy luận dài')])
    const result = await runAgent(input(), depsFor(adapter))

    expect(result.stopReason).toBe('output_limit')
    expect(result.status).toBe('budget_exceeded')
    expect(result.error).toBeTruthy()
  })

  it('returns the answer normally when the model does produce text', async () => {
    const adapter = scriptedAdapter([
      {
        chunks: [
          { type: 'reasoning', text: 'Nghĩ ngắn' },
          { type: 'text', text: 'KPI tháng này tăng 12%.' },
          { type: 'done', finishReason: 'stop', usage: usage(50, 40) },
        ],
      },
    ])
    const result = await runAgent(input(), depsFor(adapter))

    expect(result.output).toBe('KPI tháng này tăng 12%.')
    expect(result.stopReason).toBe('completed')
    expect(result.status).toBe('succeeded')
  })

  it('reports an empty output honestly when there was neither text nor reasoning', async () => {
    const adapter = scriptedAdapter([
      { chunks: [{ type: 'done', finishReason: 'stop', usage: usage(10, 0) }] },
    ])
    const result = await runAgent(input(), depsFor(adapter))

    expect(result.output).toBe('')
    expect(result.reasoningText).toBe('')
  })
})

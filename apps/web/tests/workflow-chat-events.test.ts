import { describe, expect, it, vi } from 'vitest'
import { moTaSuKien } from '../src/screens/TraoDoi.tsx'
import type { Translate } from '@marketing-agent/i18n'

vi.mock('../src/lib/locale-store.ts', () => ({ readLocale: () => 'vi' }))

describe('chat retains tool activity after runtime lifecycle instrumentation', () => {
  it.each(['succeeded', 'failed', 'timed_out', 'denied'])('describes tool.finished outcome %s without serializing raw payload', outcome => {
    const translate = vi.fn((key: string) => key)
    const data = { agentRole: 'content-writer', toolName: 'kb_search', outcome, argumentsJson: 'private sentinel', error: 'secret' }
    const text = moTaSuKien({ type: 'tool.finished', data, at: 0 }, translate as unknown as Translate)
    expect(text).toBe(outcome === 'succeeded' ? 'chat.event.toolCalled' : 'chat.event.toolCalledFailed')
    expect(translate).toHaveBeenCalledWith(text, { role: 'content-writer', tool: 'kb_search' })
    expect(text).not.toContain('private sentinel')
  })
})

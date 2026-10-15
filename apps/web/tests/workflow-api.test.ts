import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, openConversationStream, setUnauthorizedHandler } from '../src/lib/api.ts'
import type { StreamEvent } from '../src/lib/api.ts'

vi.mock('../src/lib/locale-store.ts', () => ({ readLocale: () => 'vi' }))

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly listeners = new Map<string, EventListener>()
  onopen: (() => void) | null = null
  onerror: ((event: Event) => void) | null = null
  close = vi.fn()
  constructor(readonly url: string) { FakeEventSource.instances.push(this) }
  addEventListener(type: string, listener: EventListener) { this.listeners.set(type, listener) }
  emit(type: string, value: unknown, raw = false) {
    this.listeners.get(type)?.({ data: raw ? value : JSON.stringify(value) } as MessageEvent)
  }
}
beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})
afterEach(() => {
  vi.unstubAllGlobals()
  setUnauthorizedHandler(undefined)
})

describe('workflow HTTP transport', () => {
  it('fetches the typed workflow snapshot with caller abort and locale/cookies', async () => {
    const snapshot = { schemaVersion: 1, conversation: { id: 'conv/1' }, activeRuns: [] }
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot)))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    expect(await api.workflow('conv/1', controller.signal)).toEqual(snapshot)
    expect(fetch).toHaveBeenCalledWith('/api/conversations/conv%2F1/workflow', expect.objectContaining({
      credentials: 'same-origin', signal: controller.signal,
      headers: { Accept: 'application/json', 'Accept-Language': 'vi' },
    }))
  })
  it('supports aborting list requests while old chat callers can omit the signal', async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response('{"conversations":[]}'))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    await api.conversations('company', controller.signal)
    await api.conversations('company')
    expect(fetch.mock.calls[0]?.[1].signal).toBe(controller.signal)
    expect(fetch.mock.calls[1]?.[1]).not.toHaveProperty('signal')
  })
  it.each([401, 403, 404])('preserves HTTP %i as ApiError for hook termination', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: {
      code: 'scope_denied', message: 'Denied', messageKey: 'errors.denied',
    } }), { status })))
    const unauthorized = vi.fn()
    setUnauthorizedHandler(unauthorized)
    await expect(api.workflow('conv')).rejects.toMatchObject({
      name: 'ApiError', status, code: 'scope_denied', messageKey: 'errors.denied',
    })
    expect(unauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0)
  })
  it('propagates an aborted fetch rather than disguising it as an API error', async () => {
    const error = new DOMException('aborted', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
    await expect(api.workflow('conv')).rejects.toBe(error)
    expect(error).not.toBeInstanceOf(ApiError)
  })
})

describe('conversation stream compatibility', () => {
  it('unwraps server envelopes for existing chat consumers and preserves server time', () => {
    const events: StreamEvent[] = []
    const close = openConversationStream('conv', { onEvent: event => events.push(event) })
    const source = FakeEventSource.instances[0]!
    const payload = { content: 'leader reply', conversationId: 'conv' }
    source.emit('leader.replied', { type: 'leader.replied', companyId: 'company', payload, at: '2026-01-02T03:04:05Z' })
    expect(events).toEqual([{ type: 'leader.replied', companyId: 'company', data: payload, at: Date.parse('2026-01-02T03:04:05Z') }])
    expect(source.url).toBe('/api/conversations/conv/stream')
    close()
    expect(source.close).toHaveBeenCalledTimes(1)
  })
  it('listens for seven runtime events and conversation.updated', () => {
    const onEvent = vi.fn()
    openConversationStream('conv', { onEvent })
    const source = FakeEventSource.instances[0]!
    for (const type of ['run.started', 'run.finished', 'model.started', 'model.finished', 'run.retrying', 'tool.started', 'tool.finished', 'conversation.updated']) {
      expect(source.listeners.has(type)).toBe(true)
      source.emit(type, { type, companyId: 'company', at: '2026-01-01T00:00:00Z', payload: { type } })
    }
    expect(onEvent).toHaveBeenCalledTimes(8)
  })
  it('retains legacy plain JSON and malformed data for chat compatibility', () => {
    vi.spyOn(Date, 'now').mockReturnValue(123)
    const onEvent = vi.fn()
    openConversationStream('conv', { onEvent })
    const source = FakeEventSource.instances[0]!
    source.emit('agent.message', { content: 'legacy' })
    source.emit('warning', 'not json', true)
    source.emit('message', { type: 'custom', companyId: 'company', payload: {}, at: 'bad' })
    expect(onEvent.mock.calls).toEqual([
      [{ type: 'agent.message', data: { content: 'legacy' }, at: 123 }],
      [{ type: 'warning', data: 'not json', at: 123 }],
      [{ type: 'custom', companyId: 'company', data: {}, at: 123 }],
    ])
    vi.restoreAllMocks()
  })
  it('forwards open/reconnect and error callbacks without inventing replay', () => {
    const onOpen = vi.fn()
    const onError = vi.fn()
    openConversationStream('conv', { onEvent: vi.fn(), onOpen, onError })
    const source = FakeEventSource.instances[0]!
    const event = new Event('error')
    source.onopen?.()
    source.onerror?.(event)
    source.onopen?.()
    expect(onOpen).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledWith(event)
  })
})

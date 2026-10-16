import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotificationController, notificationApi, safeNotificationLink, type NotificationItem, type NotificationPage } from '../src/lib/notifications.ts'

const item = (id: string, createdAt = new Date().toISOString()): NotificationItem => ({ id, createdAt, readAt: null, type: 'agent_success', severity: 'info', title: id, body: 'Done' })
function setup() {
  const client = {
    list: vi.fn(async (): Promise<NotificationPage> => ({ items: [item('old', '2020-01-01T00:00:00.000Z')], nextCursor: 'cursor-1' })),
    count: vi.fn(async () => ({ count: 1 })),
    preferences: vi.fn(async () => ({ agent: true, actionRequired: true, budget: true })),
    savePreferences: vi.fn(async (_company, preferences) => preferences),
    read: vi.fn(async () => ({ ok: true })), readAll: vi.fn(async () => ({ ok: true })),
  } satisfies typeof notificationApi
  const publish = vi.fn(), deliver = vi.fn(), toast = vi.fn()
  const controller = new NotificationController('company', publish, deliver, client, toast)
  return { controller, client, publish, deliver, toast }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('notification inbox controller', () => {
  it('serializes self persistence behind an in-flight poll and never emits settings desktop/toast', async () => {
    const { controller, client, deliver, toast } = setup()
    await controller.refresh()
    controller.setBrowserEnabled(true)
    let resolve!: (page: NotificationPage) => void
    client.list.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const poll = controller.refresh()
    await Promise.resolve()
    const self: NotificationItem = { ...item('settings', new Date(Date.now() + 1000).toISOString()), type: 'settings_success' }
    controller.acceptSelf(self)
    client.list.mockResolvedValue({ items: [self], nextCursor: null })
    client.count.mockResolvedValue({ count: 2 })
    resolve({ items: [item('old')], nextCursor: null })
    await poll
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(controller.state.items[0]?.id).toBe('settings')
    expect(controller.state.count).toBe(2)
    expect(deliver).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
    controller.stop()
  })
  it('does not replay historical inbox or notify without explicit opt-in', async () => {
    const { controller, client, deliver, toast } = setup()
    await controller.refresh()
    expect(deliver).not.toHaveBeenCalled()
    client.list.mockResolvedValue({ items: [item('new', new Date(Date.now() + 1000).toISOString())], nextCursor: null })
    await controller.refresh()
    expect(deliver).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledTimes(1)
    controller.setBrowserEnabled(true)
    await controller.refresh()
    expect(deliver).not.toHaveBeenCalled()
    client.list.mockResolvedValue({ items: [item('newer', new Date(Date.now() + 2000).toISOString()), item('another', new Date(Date.now() + 1000).toISOString())], nextCursor: null })
    await controller.refresh()
    await controller.refresh()
    expect(deliver).toHaveBeenCalledTimes(1)
    controller.stop()
  })
  it('coalesces refresh and ignores stale responses after disposal', async () => {
    const { controller, client, publish } = setup()
    let resolve!: (page: NotificationPage) => void
    client.list.mockImplementation(() => new Promise((done) => { resolve = done }))
    const first = controller.refresh()
    void controller.refresh()
    await Promise.resolve()
    expect(client.list).toHaveBeenCalledTimes(1)
    controller.stop()
    const calls = publish.mock.calls.length
    resolve({ items: [item('stale')], nextCursor: null })
    await first
    expect(publish).toHaveBeenCalledTimes(calls)
  })
  it('serializes mutations after refresh and sends displayed read-all boundary', async () => {
    const { controller, client } = setup()
    await controller.refresh()
    const through = controller.state.items[0]!.createdAt
    await controller.readAll(through)
    expect(client.readAll).toHaveBeenCalledWith('company', through, expect.any(AbortSignal), ['old'])
    expect(controller.state.items[0]?.readAt).toBe(through)
    await controller.read('old')
    await controller.savePreferences({ agent: false, budget: true, actionRequired: true })
    expect(controller.state.preferences?.agent).toBe(false)
    controller.stop()
  })
  it('replaces first-page cursor until pagination and deduplicates older pages', async () => {
    const { controller, client } = setup()
    await controller.refresh()
    client.list.mockResolvedValue({ items: [item('new')], nextCursor: 'new-cursor' })
    await controller.refresh()
    expect(controller.state.items.map((value) => value.id)).toEqual(['new'])
    expect(controller.state.nextCursor).toBe('new-cursor')
    client.list.mockResolvedValue({ items: [item('new'), item('older')], nextCursor: null })
    await controller.loadMore()
    expect(controller.state.items.map((value) => value.id)).toEqual(['new', 'older'])
    client.list.mockResolvedValue({ items: [item('newest'), item('new')], nextCursor: 'first-page' })
    await controller.refresh()
    expect(controller.state.nextCursor).toBeNull()
    expect(controller.state.items.map((value) => value.id)).toEqual(['newest', 'new', 'older'])
    client.list.mockResolvedValue({ items: [item('burst')], nextCursor: 'gap-cursor' })
    await controller.refresh()
    expect(controller.state.items.map((value) => value.id)).toEqual(['burst'])
    expect(controller.state.nextCursor).toBe('gap-cursor')
    controller.stop()
  })
  it('polls after completion every 30 seconds and cancels on cleanup', async () => {
    vi.useFakeTimers()
    const { controller, client } = setup()
    controller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(client.list).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(client.list).toHaveBeenCalledTimes(2)
    controller.setVisible(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(client.list).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(29_999)
    expect(client.list).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(client.list).toHaveBeenCalledTimes(4)
    controller.setVisible(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(client.list).toHaveBeenCalledTimes(5)
    controller.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(client.list).toHaveBeenCalledTimes(5)
  })
  it('retains errors for retry without changing preferences optimistically', async () => {
    const { controller, client } = setup()
    await controller.refresh()
    client.savePreferences.mockRejectedValue(new Error('offline'))
    await controller.savePreferences({ agent: false, budget: false, actionRequired: false })
    expect(controller.state.error).toBeInstanceOf(Error)
    expect(controller.state.preferences?.agent).toBe(true)
    controller.stop()
  })
})

describe('notification request contract and safe navigation', () => {
  it('uses company scope, cursor, existing locale/cookie request conventions', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ items: [], nextCursor: null })))
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('window', { localStorage: { getItem: () => 'en' }, navigator: { languages: ['en'] } })
    await notificationApi.list('a/b', 'opaque value', new AbortController().signal)
    expect(fetch).toHaveBeenCalledWith('/api/companies/a%2Fb/notifications?limit=20&cursor=opaque+value', expect.objectContaining({ credentials: 'same-origin', headers: expect.objectContaining({ 'Accept-Language': expect.any(String) }) }))
  })
  it('blocks external, script, protocol-relative and malformed links', () => {
    expect(safeNotificationLink('/cong-viec?taskId=abc')).toBe('#/cong-viec?taskId=abc')
    expect(safeNotificationLink('#/chi-phi')).toBe('#/chi-phi')
    for (const link of ['javascript:alert(1)', '//evil.test', 'https://evil.test', '/\\evil.test', '/bad route']) expect(safeNotificationLink(link)).toBeUndefined()
  })
})

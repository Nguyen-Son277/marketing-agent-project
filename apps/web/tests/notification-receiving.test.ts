import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotificationController, notificationApi, type NotificationItem, type NotificationPage } from '../src/lib/notifications.ts'
import { enqueueToast, notificationToast, type WebToast } from '../src/lib/notification-toasts.ts'
const date = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString()
const item = (n: number): NotificationItem => ({ id: `id${n}`, createdAt: date(n), readAt: null, type: 'agent_success', severity: 'info', title: `Title${n}`, body: 'Body' })
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
function setup() {
  const client = {
    list: vi.fn(async (): Promise<NotificationPage> => ({ items: [item(0)], nextCursor: null })),
    count: vi.fn(async () => ({ count: 20 })),
    preferences: vi.fn(async () => ({ agent: true, actionRequired: true, budget: true })),
    savePreferences: vi.fn(async (_company, preferences) => preferences),
    read: vi.fn(async () => ({})), readAll: vi.fn(async () => ({})),
  } satisfies typeof notificationApi
  const web = vi.fn(), desktop = vi.fn(), summary = vi.fn()
  const controller = new NotificationController('c', vi.fn(), desktop, client, web, summary)
  return { client, web, desktop, summary, controller }
}
afterEach(() => vi.useRealTimers())
describe('received web notification delivery', () => {
  it('suppresses first history, emits every new unread oldest first and never repeats', async () => {
    const { controller, client, web, desktop } = setup()
    await controller.refresh()
    expect(web).not.toHaveBeenCalled()
    client.list.mockResolvedValue({ items: [item(3), { ...item(2), readAt: date(3) }, item(1), item(0)], nextCursor: null })
    await controller.refresh()
    expect(web.mock.calls.map(([value]) => value.id)).toEqual(['id1', 'id3'])
    expect(desktop).not.toHaveBeenCalled()
    await controller.refresh()
    expect(web).toHaveBeenCalledTimes(2)
    controller.stop()
  })
  it('desktop enable baseline never suppresses web, settings never duplicate', async () => {
    const { controller, client, web, desktop } = setup()
    await controller.refresh()
    controller.setBrowserEnabled(true)
    client.list.mockResolvedValue({ items: [{ ...item(3), type: 'settings_success' }, item(2), item(1)], nextCursor: null })
    await controller.refresh()
    expect(web.mock.calls.map(([value]) => value.id)).toEqual(['id1', 'id2'])
    expect(desktop).not.toHaveBeenCalled() // Dates predate desktop opt-in, not web watermark.
    controller.stop()
  })
  it('holds hidden arrivals, reconciles read state and merges resume arrivals chronologically', async () => {
    const { controller, client, web } = setup()
    await controller.refresh()
    controller.setVisible(false)
    client.list.mockResolvedValue({ items: [item(2), item(1)], nextCursor: null })
    await controller.refresh()
    expect(web).not.toHaveBeenCalled()
    client.list.mockResolvedValue({ items: [item(3), item(2), { ...item(1), readAt: date(3) }], nextCursor: null })
    controller.setVisible(true)
    await settle()
    expect(web.mock.calls.map(([value]) => value.id)).toEqual(['id2', 'id3'])
    controller.stop()
  })
  it('bounds hidden pending to four details plus summary and clears on company cleanup', async () => {
    const { controller, client, web, summary } = setup()
    await controller.refresh()
    controller.setVisible(false)
    client.list.mockResolvedValue({ items: Array.from({ length: 10 }, (_, i) => item(10 - i)), nextCursor: null })
    await controller.refresh()
    controller.setVisible(true)
    await settle()
    expect(web).toHaveBeenCalledTimes(4)
    expect(summary).toHaveBeenCalledWith(6)
    controller.setVisible(false)
    client.list.mockResolvedValue({ items: [item(11)], nextCursor: null })
    await controller.refresh()
    controller.stop()
    controller.setVisible(true)
    await settle()
    expect(web).toHaveBeenCalledTimes(4)
  })
  it('catches multi-page burst even if a known self settings item is interleaved', async () => {
    const { controller, client, web } = setup()
    await controller.refresh()
    const self: NotificationItem = { ...item(10), type: 'settings_success' }
    controller.acceptSelf(self)
    await settle()
    client.list.mockImplementation(async (_company, cursor) => cursor ? { items: [item(2), item(1), item(0)], nextCursor: null } : { items: [item(4), self, item(3)], nextCursor: 'older' })
    await controller.refresh()
    expect(web.mock.calls.map(([value]) => value.id)).toEqual(['id1', 'id2', 'id3', 'id4'])
    controller.stop()
  })
  it('reports bounded catchup backlog once and does not repeat next poll', async () => {
    const { controller, client, summary } = setup()
    await controller.refresh()
    client.count.mockResolvedValue({ count: 200 })
    client.list.mockImplementation(async (_company, cursor) => {
      const n = cursor ? Number(cursor) : 0
      return { items: [item(100 - n)], nextCursor: String(n + 1) }
    })
    await controller.refresh()
    expect(summary).toHaveBeenCalledWith(194)
    await controller.refresh()
    expect(summary).toHaveBeenCalledTimes(1)
    controller.stop()
  })
})
describe('bounded received toast queue', () => {
  it('preserves four oldest details and accounts for every overflow in fifth summary', () => {
    let queue: WebToast[] = []
    for (let i = 1; i <= 20; i++) queue = enqueueToast(queue, notificationToast(item(i)))
    expect(queue).toHaveLength(5)
    expect(queue.slice(0, 4).map((toast) => toast.id)).toEqual(['id1', 'id2', 'id3', 'id4'])
    expect(queue[4]).toMatchObject({ count: 16 })
    expect(notificationToast({ ...item(1), title: 'a'.repeat(300), body: 'b'.repeat(500), severity: 'error' })).toMatchObject({ title: 'a'.repeat(180), body: 'b'.repeat(280), severity: 'error' })
  })
  it('deduplicates queued IDs and merges summary batches', () => {
    const one = notificationToast(item(1))
    let queue = enqueueToast([one], one)
    expect(queue).toHaveLength(1)
    queue = enqueueToast(queue, { id: 'summary1', count: 5 })
    queue = enqueueToast(queue, { id: 'summary2', count: 7 })
    expect(queue[1]).toMatchObject({ count: 12 })
  })
})

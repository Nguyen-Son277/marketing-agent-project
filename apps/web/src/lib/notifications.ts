import { request } from './api.ts'

import type { NotificationItem, NotificationPreferences, NotificationsResponse } from '@marketing-agent/shared'
export type { NotificationItem, NotificationPreferences } from '@marketing-agent/shared'
export type NotificationPage = NotificationsResponse
export const notificationApi = {
  list(companyId: string, cursor: string | null, signal: AbortSignal): Promise<NotificationPage> {
    const query = new URLSearchParams({ limit: '20' })
    if (cursor) query.set('cursor', cursor)
    return request(`/api/companies/${encodeURIComponent(companyId)}/notifications?${query}`, { signal })
  },
  count(companyId: string, signal: AbortSignal): Promise<{ count: number }> {
    return request(`/api/companies/${encodeURIComponent(companyId)}/notifications/unread-count`, { signal })
  },
  preferences(companyId: string, signal: AbortSignal): Promise<NotificationPreferences> {
    return request(`/api/companies/${encodeURIComponent(companyId)}/notification-preferences`, { signal })
  },
  savePreferences(companyId: string, body: NotificationPreferences, signal: AbortSignal): Promise<NotificationPreferences> {
    return request(`/api/companies/${encodeURIComponent(companyId)}/notification-preferences`, { method: 'PUT', body, signal })
  },
  read(companyId: string, id: string, signal: AbortSignal): Promise<unknown> {
    return request(`/api/companies/${encodeURIComponent(companyId)}/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', body: {}, signal })
  },
  readAll(companyId: string, through: string, signal: AbortSignal, throughIds?: string[]): Promise<unknown> {
    return request(`/api/companies/${encodeURIComponent(companyId)}/notifications/read-all`, { method: 'POST', body: { through, throughIds }, signal })
  },
}

/** Only app hash routes are navigable; never execute a server-supplied URL. */
export function safeNotificationLink(link?: string): string | undefined {
  if (!link) return undefined
  if (/^#\/[a-z0-9-]+(?:\?[^\s]*)?$/.test(link)) return link
  if (/^\/[a-z0-9-]+(?:\?[^\s]*)?$/.test(link)) return `#${link}`
  return undefined
}

export interface NotificationState {
  items: NotificationItem[]
  count: number
  nextCursor: string | null
  preferences: NotificationPreferences | null
  loading: boolean
  error: unknown
}
const initialState = (): NotificationState => ({ items: [], count: 0, nextCursor: null, preferences: null, loading: true, error: null })

/** One queue for polling, pagination and writes: stale reads cannot undo a read mutation. */
export class NotificationController {
  state = initialState()
  private queue: Promise<void> = Promise.resolve()
  private abort = new AbortController()
  private active = true
  private refreshQueued = false
  private initialized = false
  private paginated = false
  private desktopBaseline = Date.now()
  private webBaseline = ''
  private visible = true
  private started = false
  private hiddenItems: NotificationItem[] = []
  private hiddenOverflow = 0
  private resuming = false
  private seen = new Set<string>()
  private browserEnabled = false
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(private companyId: string, private publish: (state: NotificationState) => void,
    private deliver: (item: NotificationItem) => void, private client = notificationApi,
    private onNew?: (item: NotificationItem) => void,
    private onOverflow?: (count: number) => void) {}

  private update(patch: Partial<NotificationState>): void {
    if (!this.active) return
    this.state = { ...this.state, ...patch }
    this.publish(this.state)
  }
  private enqueue(work: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (!this.active) return
      this.update({ loading: true, error: null })
      try { await work() } catch (error) { if (!this.abort.signal.aborted) this.update({ error }) }
      finally { this.update({ loading: false }) }
    })
    return this.queue
  }
  setBrowserEnabled(enabled: boolean): void {
    this.browserEnabled = enabled
    // Enabling is not permission to replay any existing inbox items.
    this.desktopBaseline = Date.now()
  }
  setVisible(visible: boolean): void {
    if (!this.active) return
    const changed = this.visible !== visible
    this.visible = visible
    if (visible && changed) {
      this.resuming = true
      void this.refresh().then(() => {
        if (!this.active || !this.visible) return
        this.hiddenItems.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        for (const item of this.state.count > 0 ? this.hiddenItems : []) {
          const latest = this.state.items.find((current) => current.id === item.id)
          if (!(latest ?? item).readAt) this.onNew?.(latest ?? item)
        }
        if (this.hiddenOverflow && this.state.count > 0) this.onOverflow?.(Math.min(this.hiddenOverflow, this.state.count))
        this.hiddenItems = []
        this.hiddenOverflow = 0
        this.resuming = false
      })
    }
    if (changed && this.started) {
      clearTimeout(this.timer)
      // A visibility change refreshes immediately, then starts the matching cadence.
      void this.tick()
    }
  }
  private emitWeb(items: NotificationItem[]): void {
    if (this.visible && !this.resuming) { for (const item of items) this.onNew?.(item); return }
    for (const item of items) {
      if (this.hiddenItems.length < 4) this.hiddenItems.push(item)
      else this.hiddenOverflow++
    }
  }
  refresh = (): Promise<void> => {
    if (!this.active || this.refreshQueued) return this.queue
    this.refreshQueued = true
    return this.enqueue(async () => {
      try {
        const page = await this.client.list(this.companyId, null, this.abort.signal)
        const arrivals = [...page.items]
        // Catch up through intervening pages after a reconnect/burst, not just newest20.
        let cursor = page.nextCursor
        const cursors = new Set<string>()
        while (this.initialized && cursor && cursors.size < 5 && !arrivals.some((item) => item.createdAt < this.webBaseline || (item.createdAt === this.webBaseline && this.seen.has(item.id) && !item.type.startsWith('settings_')))) {
          if (cursors.has(cursor)) break
          cursors.add(cursor)
          const older = await this.client.list(this.companyId, cursor, this.abort.signal)
          arrivals.push(...older.items)
          cursor = older.nextCursor
          if (!older.items.length) break
        }
        const count = await this.client.count(this.companyId, this.abort.signal)
        const preferences = await this.client.preferences(this.companyId, this.abort.signal)
        if (!this.active) return
        const fresh = arrivals.filter((item, index) => !this.seen.has(item.id) && !item.type.startsWith('settings_') && arrivals.findIndex((other) => other.id === item.id) === index)
        for (const item of arrivals) this.seen.add(item.id)
        if (this.initialized) {
          this.emitWeb(fresh.filter((item) => !item.readAt && item.createdAt >= this.webBaseline)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)))
          if (cursor && cursors.size >= 5) {
            // The catch-up scan is bounded; expose remaining durable backlog explicitly.
            const remaining = Math.max(0, count.count - arrivals.filter((item) => !item.readAt).length)
            if (remaining) {
              if (this.visible && !this.resuming) this.onOverflow?.(remaining)
              else this.hiddenOverflow += remaining
            }
          }
        } else {
          // First successful snapshot is historical, even if the initial request took time.
          this.webBaseline = page.items.length ? page.items.reduce((latest, item) => item.createdAt > latest ? item.createdAt : latest, page.items[0]!.createdAt) : new Date().toISOString()
        }
        if (this.initialized && this.browserEnabled) {
          // At most one desktop notification per poll, never historical or read entries.
          const item = fresh.find((item) => !item.readAt && Date.parse(item.createdAt) > this.desktopBaseline)
          if (item) { try { this.deliver(item) } catch { /* Browser may revoke permission. */ } }
        }
        if (this.initialized && page.items.length) this.webBaseline = page.items.reduce((latest, item) => item.createdAt > latest ? item.createdAt : latest, this.webBaseline)
        this.initialized = true
        const ids = new Set(page.items.map((item) => item.id))
        // No overlap means a burst displaced the whole first page. Reset pagination
        // rather than skipping the gap between that page and the previously loaded tail.
        if (this.paginated && !this.state.items.some((item) => ids.has(item.id))) this.paginated = false
        const items = this.paginated ? [...page.items, ...this.state.items.filter((item) => !ids.has(item.id))] : page.items
        // Until the user paginates, replace the first page and its matching cursor atomically.
        this.update({ items, count: count.count, preferences, nextCursor: this.paginated ? this.state.nextCursor : page.nextCursor })
      } finally { this.refreshQueued = false }
    })
  }
  loadMore = (): Promise<void> => this.enqueue(async () => {
    if (!this.state.nextCursor) return
    const page = await this.client.list(this.companyId, this.state.nextCursor, this.abort.signal)
    this.paginated = true
    const ids = new Set(this.state.items.map((item) => item.id))
    for (const item of page.items) this.seen.add(item.id)
    this.update({ items: [...this.state.items, ...page.items.filter((item) => !ids.has(item.id))], nextCursor: page.nextCursor })
  })
  read = (id: string): Promise<void> => this.enqueue(async () => {
    await this.client.read(this.companyId, id, this.abort.signal)
    const count = await this.client.count(this.companyId, this.abort.signal)
    this.update({ items: this.state.items.map((item) => item.id === id ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item), count: count.count })
  })
  readAll = (through: string): Promise<void> => {
    // Capture the displayed boundary before entering the queue, not after a poll.
    const throughIds = this.state.items.filter((item) => item.createdAt === through).map((item) => item.id).slice(0, 100)
    return this.enqueue(async () => {
      await this.client.readAll(this.companyId, through, this.abort.signal, throughIds)
      const count = await this.client.count(this.companyId, this.abort.signal)
      this.update({ items: this.state.items.map((item) => item.createdAt < through || throughIds.includes(item.id) ? { ...item, readAt: item.readAt ?? through } : item), count: count.count })
    })
  }
  savePreferences = (preferences: NotificationPreferences): Promise<void> => this.enqueue(async () => {
    const saved = await this.client.savePreferences(this.companyId, preferences, this.abort.signal)
    this.update({ preferences: saved })
  })
  acceptSelf(item: NotificationItem): void {
    if (!this.active) return
    this.seen.add(item.id)
    void this.enqueue(async () => {
      const exists = this.state.items.some((existing) => existing.id === item.id)
      this.update({ items: [item, ...this.state.items.filter((existing) => existing.id !== item.id)], count: this.state.count + (!exists && !item.readAt ? 1 : 0) })
    }).then(() => this.refresh())
  }
  private tick = async (): Promise<void> => {
    await this.refresh()
    clearTimeout(this.timer)
    if (this.active && this.started) this.timer = setTimeout(() => { void this.tick() }, this.visible ? 5000 : 30_000)
  }
  start(): void {
    if (this.started || !this.active) return
    this.started = true
    void this.tick()
  }
  stop(): void {
    this.active = false
    this.abort.abort()
    clearTimeout(this.timer)
    this.seen.clear()
    this.hiddenItems = []
    this.hiddenOverflow = 0
    this.started = false
  }
}

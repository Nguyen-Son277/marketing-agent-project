import type { NotificationItem, NotificationSeverity } from '@marketing-agent/shared'
import type { SettingsToast } from './settings-notifications.ts'
export type WebToast = SettingsToast | { id: string; title: string; body: string; severity: NotificationSeverity } | { id: string; count: number }
export function notificationToast(item: NotificationItem): WebToast {
  return { id: item.id, title: item.title.slice(0, 180), body: item.body.slice(0, 280), severity: item.severity }
}
function weight(toast: WebToast): number { return 'count' in toast ? toast.count : 1 }
/** Preserve active+oldest waiting entries and summarize every overflow instead of dropping. */
export function enqueueToast(queue: WebToast[], incoming: WebToast): WebToast[] {
  if (queue.some((toast) => toast.id === incoming.id && !('count' in toast))) return queue
  const summaryIndex = queue.findIndex((toast) => 'count' in toast)
  if (summaryIndex >= 0) return queue.map((toast, index) => index === summaryIndex && 'count' in toast ? { ...toast, count: toast.count + weight(incoming) } : toast)
  if (queue.length < 5) return [...queue, incoming]
  return [...queue.slice(0, 4), { id: `summary:${queue[4]!.id}`, count: weight(queue[4]!) + weight(incoming) }]
}

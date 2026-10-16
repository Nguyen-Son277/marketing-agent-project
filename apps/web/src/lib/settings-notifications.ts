import { useSession } from './session.tsx'
import { ApiError, request } from './api.ts'
import type { NotificationItem, SettingsNotificationOperation, SettingsNotificationStatus } from '@marketing-agent/shared'

export type SettingsOperation = SettingsNotificationOperation
export type SettingsStatus = SettingsNotificationStatus
export interface SettingsToast { id: string; operation: SettingsOperation; status: SettingsStatus }
interface Host { userId: string; companyId: string; signal: AbortSignal; toast: (event: SettingsToast) => void; persisted: (item: NotificationItem) => void }
let host: Host | undefined
export function registerSettingsNotificationHost(next: Host): () => void {
  host = next
  return () => { if (host === next) host = undefined }
}

/** Capture identity at action start, not at async completion. Never persist raw results. */
export function beginSettingsAction(userId: string | undefined, companyId: string, operation: SettingsOperation): (status: SettingsStatus) => void {
  const captured = host
  const operationId = crypto.randomUUID()
  let finished = false
  return (status) => {
    if (finished) return
    finished = true
    if (!captured || host !== captured || captured.signal.aborted || captured.userId !== userId || captured.companyId !== companyId) return
    captured.toast({ id: operationId, operation, status })
    const deliver = async (): Promise<void> => {
      // Delivery retries reuse the idempotency token; the underlying action is never retried.
      for (let attempt = 0; attempt < 2; attempt++) {
        if (captured.signal.aborted || host !== captured) return
        try {
          const result = await request<{ item: NotificationItem }>(`/api/companies/${encodeURIComponent(companyId)}/notifications/settings`, {
            method: 'POST', body: { operationId, operation, status }, signal: captured.signal,
          })
          if (!captured.signal.aborted && host === captured) captured.persisted(result.item)
          return
        } catch (error) {
          if (captured.signal.aborted || (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429)) return
        }
      }
    }
    void deliver()
  }
}
export function useSettingsNotifications(companyId: string): { begin: (operation: SettingsOperation) => (status: SettingsStatus) => void } {
  const { user } = useSession()
  return { begin: (operation) => beginSettingsAction(user?.id, companyId, operation) }
}

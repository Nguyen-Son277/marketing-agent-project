/** Durable, company-scoped inbox contract. Dates are UTC ISO strings. */
export type NotificationType = 'agent_success' | 'agent_failure' | 'budget_warning' | 'budget_exceeded' | 'settings_success' | 'settings_warning' | 'settings_error'
export const SETTINGS_NOTIFICATION_OPERATIONS = [
  'provider.save', 'provider.delete', 'provider.test',
  'key.save', 'key.delete', 'key.test',
  'model.save', 'model.delete', 'model.fetch', 'model.purge',
  'route.save', 'integration.save', 'integration.test', 'limits.save',
  'knowledgeModel.save', 'knowledgeModel.test',
] as const
export type SettingsNotificationOperation = typeof SETTINGS_NOTIFICATION_OPERATIONS[number]
export type SettingsNotificationStatus = 'success' | 'warning' | 'error'
export interface SettingsNotificationRequest {
  /** Opaque client-generated ID, reused for delivery retries of the same operation. */
  operationId: string
  operation: SettingsNotificationOperation
  status: SettingsNotificationStatus
}
export interface SettingsNotificationResponse { item: NotificationItem }
export type NotificationSeverity = 'info' | 'warning' | 'error'
export interface NotificationItem {
  id: string
  type: NotificationType
  severity: NotificationSeverity
  createdAt: string
  readAt: string | null
  title: string
  body: string
  link?: string
}
export interface NotificationPreferences { agent: boolean; actionRequired: boolean; budget: boolean }
export interface NotificationsResponse { items: NotificationItem[]; nextCursor: string | null }

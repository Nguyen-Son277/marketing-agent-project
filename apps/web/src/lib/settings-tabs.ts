export const SETTINGS_TABS = [
  { id: 'providers', label: 'settings.tabs.providers' },
  { id: 'models', label: 'settings.tabs.models' },
  { id: 'routes', label: 'settings.tabs.routes' },
  { id: 'knowledge', label: 'settings.tabs.knowledge' },
  { id: 'integrations', label: 'settings.tabs.integrations' },
  { id: 'wordpress', label: 'settings.tabs.wordpress' },
  { id: 'limits', label: 'settings.tabs.limits' },
] as const
export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id']

export function settingsTabFromHash(hash: string): SettingsTabId {
  const [route, query] = hash.split('?')
  if (route !== '#/cai-dat') return 'providers'
  const tab = new URLSearchParams(query).get('tab')
  return SETTINGS_TABS.find(item => item.id === tab)?.id ?? 'providers'
}

export function settingsTabForKey(key: string, index: number): SettingsTabId | null {
  const last = SETTINGS_TABS.length - 1
  const next = key === 'ArrowRight' ? (index + 1) % SETTINGS_TABS.length
    : key === 'ArrowLeft' ? (index + last) % SETTINGS_TABS.length
    : key === 'Home' ? 0 : key === 'End' ? last : -1
  return SETTINGS_TABS[next]?.id ?? null
}

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../lib/i18n.tsx'
import { SETTINGS_TABS, settingsTabForKey, settingsTabFromHash, type SettingsTabId } from '../lib/settings-tabs.ts'

const SettingsTabActive = createContext(true)
export const useSettingsTabActive = (): boolean => useContext(SettingsTabActive)

/** Visited panels stay mounted so changing tabs never discards an unsaved draft. */
export function SettingsTabs({ panels }: { panels: Record<SettingsTabId, ReactNode> }): ReactNode {
  const { t } = useI18n()
  const id = useId()
  const [active, setActive] = useState(() => settingsTabFromHash(window.location.hash))
  const [visited, setVisited] = useState<Set<SettingsTabId>>(() => new Set([active]))
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const strip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const update = (): void => setActive(settingsTabFromHash(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  useEffect(() => { setVisited(previous => previous.has(active) ? previous : new Set([...previous, active])) }, [active])
  useEffect(() => {
    const row = strip.current
    if (!row) return
    const reveal = (): void => {
      const button = buttons.current[SETTINGS_TABS.findIndex(tab => tab.id === active)]
      if (!button) return
      const bounds = row.getBoundingClientRect(), item = button.getBoundingClientRect()
      row.scrollLeft += item.left < bounds.left ? item.left - bounds.left : item.right > bounds.right ? item.right - bounds.right : 0
    }
    reveal()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(reveal)
    observer.observe(row)
    return () => observer.disconnect()
  }, [active])
  function select(tab: SettingsTabId): void {
    if (active === tab) return
    setActive(tab)
    window.location.hash = `#/cai-dat?tab=${tab}`
  }
  return <>
    <div className="settings-tabs" role="tablist" aria-label={t('settings.title')} ref={strip}>
      {SETTINGS_TABS.map((tab, index) => <button key={tab.id} type="button" role="tab"
        id={`${id}-${tab.id}`} aria-selected={active === tab.id} aria-controls={`${id}-${tab.id}-panel`}
        tabIndex={active === tab.id ? 0 : -1} ref={element => { buttons.current[index] = element }}
        onClick={() => select(tab.id)} onKeyDown={event => {
          const next = settingsTabForKey(event.key, index)
          if (!next) return
          event.preventDefault()
          select(next)
          const button = buttons.current[SETTINGS_TABS.findIndex(item => item.id === next)]
          button?.focus()
          button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        }}>{t(tab.label)}</button>)}
    </div>
    {SETTINGS_TABS.map(tab => <div key={tab.id} role="tabpanel" id={`${id}-${tab.id}-panel`}
      aria-labelledby={`${id}-${tab.id}`} hidden={active !== tab.id} tabIndex={0} className="settings-panel">
      <SettingsTabActive.Provider value={active === tab.id}>
        {(visited.has(tab.id) || active === tab.id) ? panels[tab.id] : null}
      </SettingsTabActive.Provider>
    </div>)}
  </>
}

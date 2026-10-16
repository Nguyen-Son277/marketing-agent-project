import { useEffect, useRef, useState } from 'react'
import { NotificationController, safeNotificationLink, type NotificationPreferences, type NotificationState } from '../lib/notifications.ts'
import { useI18n } from '../lib/i18n.tsx'
import { HopThoai } from './HopThoai.tsx'
import { SettingsToastView } from './NotificationToast.tsx'
import { registerSettingsNotificationHost } from '../lib/settings-notifications.ts'
import { enqueueToast, notificationToast, type WebToast } from '../lib/notification-toasts.ts'

function browserSupported(): boolean { return typeof Notification !== 'undefined' && window.isSecureContext }
function optInKey(userId: string, companyId: string): string { return `ma.notifications:${userId}:${companyId}` }
function readOptIn(key: string): boolean {
  try { return browserSupported() && Notification.permission === 'granted' && localStorage.getItem(key) === 'true' } catch { return false }
}

/** Remounted on company/user changes so no old inbox or pending permission result can leak. */
export function NotificationBell({ companyId, userId }: { companyId: string; userId: string }) {
  const { t, locale, formatDateTime, translateError } = useI18n()
  const [open, setOpen] = useState(false)
  const [toasts, setToasts] = useState<WebToast[]>([])
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  const toast = toasts[0]
  const dismissToast = () => setToasts((queue) => queue.slice(1))
  const [state, setState] = useState<NotificationState>({ items: [], count: 0, nextCursor: null, preferences: null, loading: true, error: null })
  const key = optInKey(userId, companyId)
  const [browserEnabled, setBrowserEnabled] = useState(() => readOptIn(key))
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => browserSupported() ? Notification.permission : 'unsupported')
  const [permissionPending, setPermissionPending] = useState(false)
  const controller = useRef<NotificationController | null>(null)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    let active = true
    const desktop = new Set<Notification>()
    const current = new NotificationController(companyId, setState, (item) => {
      if (!browserSupported() || Notification.permission !== 'granted') return
      const notification = new Notification(item.title, { body: item.body, tag: `${companyId}:${item.id}` })
      desktop.add(notification)
      notification.onclose = () => desktop.delete(notification)
      notification.onclick = () => {
        if (!active) { notification.close(); return }
        window.focus()
        const link = safeNotificationLink(item.link)
        if (link) window.location.hash = link
        notification.close()
      }
    }, undefined, (item) => setToasts((queue) => enqueueToast(queue, notificationToast(item))),
    (count) => setToasts((queue) => enqueueToast(queue, { id: `hidden:${Date.now()}`, count })))
    const scope = new AbortController()
    const unregister = registerSettingsNotificationHost({ userId, companyId, signal: scope.signal,
      toast: (event) => setToasts((queue) => enqueueToast(queue, event)), persisted: (item) => current.acceptSelf(item) })
    controller.current = current
    current.setBrowserEnabled(readOptIn(key))
    current.setVisible(document.visibilityState === 'visible')
    current.start()
    const onFocus = () => {
      const nextVisible = document.visibilityState === 'visible'
      setVisible(nextVisible)
      current.setVisible(nextVisible)
      if (nextVisible) void current.refresh()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      mounted.current = false
      active = false
      unregister()
      scope.abort()
      for (const notification of desktop) notification.close()
      current.stop()
      controller.current = null
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [companyId, userId, key])
  useEffect(() => { void controller.current?.refresh() }, [locale])
  useEffect(() => {
    if (!toast || !visible) return
    const timer = setTimeout(() => setToasts((queue) => queue.slice(1)), 8000)
    return () => clearTimeout(timer)
  }, [toast?.id, visible])

  async function toggleBrowser(): Promise<void> {
    if (browserEnabled) {
      setBrowserEnabled(false)
      controller.current?.setBrowserEnabled(false)
      try { localStorage.removeItem(key) } catch { /* in-memory opt-in still works */ }
      return
    }
    if (!browserSupported()) return
    setPermissionPending(true)
    try {
      // Only called directly by a click; never request permission in an effect or poll.
      const result = await Notification.requestPermission()
      if (!mounted.current) return
      setPermission(result)
      const enabled = result === 'granted'
      setBrowserEnabled(enabled)
      controller.current?.setBrowserEnabled(enabled)
      if (enabled) { try { localStorage.setItem(key, 'true') } catch { /* in-memory opt-in */ } }
    } catch { if (mounted.current) setPermission('denied') }
    finally { if (mounted.current) setPermissionPending(false) }
  }
  function togglePreference(name: keyof NotificationPreferences): void {
    if (!state.preferences) return
    void controller.current?.savePreferences({ ...state.preferences, [name]: !state.preferences[name] })
  }

  return <>
    {toast && visible ? <SettingsToastView toast={toast} dismiss={dismissToast} view={() => { dismissToast(); setOpen(true); void controller.current?.refresh() }} /> : null}
    <button type="button" className="notification-bell" aria-label={t('notifications.bell', { count: state.count })}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(true); void controller.current?.refresh() }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      {state.count > 0 ? <span className="notification-badge" aria-hidden="true">{state.count > 99 ? '99+' : state.count}</span> : null}
    </button>
    <HopThoai mo={open} tieuDe={t('notifications.title')} onDong={() => setOpen(false)}>
      <div className="notification-toolbar">
        <span role="status">{t('notifications.unread', { count: state.count })}</span>
        <button type="button" className="nut nut--phu" disabled={state.loading || state.count === 0 || !state.items.length}
          onClick={() => { const through = state.items.reduce((latest, item) => item.createdAt > latest ? item.createdAt : latest, state.items[0]!.createdAt); void controller.current?.readAll(through) }}>{t('notifications.readAll')}</button>
      </div>
      {state.error ? <div role="alert"><p>{translateError(state.error)}</p><button type="button" className="nut" disabled={state.loading} onClick={() => void controller.current?.refresh()}>{t('common.retry')}</button></div> : null}
      <section aria-label={t('notifications.title')} aria-busy={state.loading}>
        {state.loading ? <p role="status">{t('common.loading')}</p> : null}
        {!state.loading && !state.error && !state.items.length ? <p>{t('notifications.empty')}</p> : null}
        <ul className="notification-list">{state.items.map((item) => {
          const link = safeNotificationLink(item.link)
          return <li key={item.id} className={`notification-item${item.readAt ? '' : ' notification-item--unread'}`}>
            <div className="notification-meta"><span>{t(`notifications.severity.${item.severity}`)}</span><time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time><span>{t(item.readAt ? 'notifications.read' : 'notifications.notRead')}</span></div>
            <h3>{item.title}</h3><p>{item.body}</p>
            <div className="notification-actions">
              {link ? <a href={link} onClick={() => { if (!item.readAt) void controller.current?.read(item.id); setOpen(false) }}>{t('notifications.open')}</a> : null}
              {!item.readAt ? <button type="button" className="nut nut--phu" disabled={state.loading} onClick={() => void controller.current?.read(item.id)}>{t('notifications.markRead')}</button> : null}
            </div>
          </li>
        })}</ul>
        {state.nextCursor ? <button type="button" className="nut" disabled={state.loading} onClick={() => void controller.current?.loadMore()}>{t('notifications.loadMore')}</button> : null}
      </section>
      <fieldset className="notification-preferences" disabled={state.loading || !state.preferences}>
        <legend>{t('notifications.preferences')}</legend>
        {(['agent', 'actionRequired', 'budget'] as const).map((name) => <label key={name}>
          <input type="checkbox" checked={state.preferences?.[name] ?? false} onChange={() => togglePreference(name)} />{t(`notifications.preference.${name}`)}
        </label>)}
      </fieldset>
      <section className="notification-browser" aria-label={t('notifications.browser')}>
        <h3>{t('notifications.browser')}</h3><p>{t('notifications.browserHelp')}</p>
        <button type="button" className="nut nut--phu" aria-pressed={browserEnabled} disabled={permissionPending || permission === 'unsupported' || (!browserEnabled && permission === 'denied')}
          onClick={() => void toggleBrowser()}>{t(browserEnabled ? 'notifications.browserDisable' : 'notifications.browserEnable')}</button>
        {permission === 'denied' ? <p role="status">{t('notifications.browserDenied')}</p> : null}
        {permission === 'unsupported' ? <p>{t('notifications.browserUnsupported')}</p> : null}
      </section>
    </HopThoai>
  </>
}

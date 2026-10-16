import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../lib/i18n.tsx'
import type { WebToast } from '../lib/notification-toasts.ts'

/** Manual popover puts the host above native dialogs without stealing form focus. */
export function SettingsToastView({ toast, dismiss, view }: {
  toast: WebToast; dismiss: () => void; view: () => void
}) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const [container, setContainer] = useState<HTMLElement>(() => document.body)
  useEffect(() => {
    let current: HTMLElement = document.body
    const sync = (records: MutationRecord[] = []) => {
      const opened = records.filter((record) => record.type === 'attributes' && record.target instanceof HTMLDialogElement && record.target.open)
      const latest = opened[opened.length - 1]?.target
      const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]')
      if (latest instanceof HTMLDialogElement) current = latest
      else if (!(current instanceof HTMLDialogElement) || !current.isConnected || !current.open) current = dialogs[dialogs.length - 1] ?? document.body
      setContainer(current)
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { attributes: true, attributeFilter: ['open'], childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const node = ref.current
    try { node?.showPopover?.() } catch { /* Older browsers still render the portal. */ }
    return () => { try { node?.hidePopover?.() } catch { /* Portal target may have unmounted. */ } }
  }, [toast.id, container])
  return createPortal(<div ref={ref} popover="manual" className="notification-toast">
    <div role={('severity' in toast && toast.severity === 'error') || ('status' in toast && toast.status === 'error') ? 'alert' : 'status'}>
      {'count' in toast ? <><strong>{t('notifications.moreReceived', { count: toast.count })}</strong><p>{t('notifications.moreReceivedHelp')}</p></> :
        'title' in toast ? <><span>{t(`notifications.severity.${toast.severity}`)}</span><strong>{toast.title}</strong><p>{toast.body}</p></> :
        <span>{t(`notifications.settings.${toast.status}`, { operation: t(`notifications.operation.${toast.operation}`) })}</span>}
    </div>
    <button type="button" className="nut nut--phu" onClick={view}>{t('notifications.viewInbox')}</button>
    <button type="button" className="nut nut--phu" onClick={dismiss} aria-label={t('common.close')}>×</button>
  </div>, container)
}

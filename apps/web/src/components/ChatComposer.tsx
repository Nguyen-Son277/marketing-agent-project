import { useId, useLayoutEffect, useRef, type RefObject } from 'react'
import { useI18n } from '../lib/i18n.tsx'
import { shouldSendChatKey } from '../lib/chat-composer.ts'

export function ChatComposer({ value, onChange, busy, onSend, inputRef }: {
  value: string; onChange: (value: string) => void; busy: boolean; onSend: () => void
  inputRef: RefObject<HTMLTextAreaElement | null>
}) {
  const { t } = useI18n()
  const hintId = useId()
  const composing = useRef(false)
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }, [value, inputRef])
  return <div className="chat__nhap">
    <div className="chat-composer">
      <textarea ref={inputRef} className="o-van-ban" value={value} rows={2} disabled={busy}
        aria-label={t('chat.composerLabel')} aria-describedby={hintId} placeholder={t('chat.placeholder')}
        onChange={(event) => onChange(event.target.value)}
        onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
        onKeyDown={(event) => {
          if (!shouldSendChatKey({ ...event, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode }, composing.current)) return
          event.preventDefault()
          if (!busy && value.trim()) onSend()
        }} />
      <button type="button" className="chat-composer__send" disabled={busy || !value.trim()} onClick={onSend}
        aria-label={t(busy ? 'chat.sending' : 'chat.send')} aria-busy={busy} title={t('chat.send')}>
        {busy ? <svg className="chat-composer__spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity=".3" /><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2" /></svg> :
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>}
      </button>
    </div>
    <p className="chat-composer__hint" id={hintId}>{t('chat.composerHint')}</p>
  </div>
}

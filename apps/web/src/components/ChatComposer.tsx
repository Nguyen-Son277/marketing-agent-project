import { useId, useLayoutEffect, useRef, type RefObject } from 'react'
import { useI18n } from '../lib/i18n.tsx'
import { shouldSendChatKey } from '../lib/chat-composer.ts'
import { CHAT_ATTACHMENT_ACCEPT, CHAT_ATTACHMENT_MAX_FILES } from '@marketing-agent/shared'
import type { DraftChatAttachment } from '../lib/useChatAttachments.ts'

export function ChatComposer({ value, onChange, busy, onSend, inputRef, attachments, attachmentError, onFiles, onRemove, onRetry }: {
  value: string; onChange: (value: string) => void; busy: boolean; onSend: () => void
  inputRef: RefObject<HTMLTextAreaElement | null>
  attachments: readonly DraftChatAttachment[]; attachmentError: string | null
  onFiles: (files: File[]) => void; onRemove: (id: number) => void; onRetry: (id: number) => void
}) {
  const { t } = useI18n()
  const hintId = useId()
  const composing = useRef(false)
  const pickerRef = useRef<HTMLInputElement>(null)
  const canSend = !busy && !!(value.trim() || attachments.length) && attachments.every((file) => file.status === 'ready')
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }, [value, inputRef])
  return <div className="chat__nhap">
    {attachments.length ? <ul className="chat-attachments" aria-label={t('chat.attachments')}>
      {attachments.map((entry) => <li className="chat-attachment" key={entry.localId}>
        {entry.previewUrl ? <img className="chat-attachment__preview" src={entry.previewUrl} alt={entry.file.name} /> : <span className="chat-attachment__file" aria-hidden="true">{entry.file.name.split('.').pop()?.toUpperCase()}</span>}
        <div className="chat-attachment__details">
          <span className="chat-attachment__name" title={entry.file.name}>{entry.file.name}</span>
          <small role="status">{entry.status === 'uploading' ? t('chat.attachmentUploading') : entry.status === 'error' ? entry.error : `${Math.max(1, Math.ceil(entry.file.size / 1024))} KiB`}</small>
          {entry.status === 'error' ? <button type="button" disabled={busy} onClick={() => onRetry(entry.localId)}>{t('common.retry')}</button> : null}
        </div>
        <button className="chat-attachment__remove" type="button" disabled={busy} aria-label={t('chat.removeAttachment', { name: entry.file.name })} onClick={() => onRemove(entry.localId)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
        </button>
      </li>)}
    </ul> : null}
    {attachmentError ? <p className="chat-attachment-error" role="alert">{attachmentError}</p> : null}
    <div className="chat-composer"
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
      onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); if (!busy) onFiles(Array.from(event.dataTransfer.files)) } }}>
      <input ref={pickerRef} type="file" hidden multiple accept={CHAT_ATTACHMENT_ACCEPT} disabled={busy}
        aria-label={t('chat.addFiles')} onChange={(event) => { if (!busy) onFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
      <textarea ref={inputRef} className="o-van-ban" value={value} rows={2} disabled={busy}
        aria-label={t('chat.composerLabel')} aria-describedby={hintId} placeholder={t('chat.placeholder')}
        onChange={(event) => onChange(event.target.value)}
        onPaste={(event) => {
          const images = Array.from(event.clipboardData.items).filter((item) => item.kind === 'file' && item.type.startsWith('image/')).map((item) => item.getAsFile()).filter((file): file is File => file !== null)
          if (images.length && !busy) { event.preventDefault(); onFiles(images) }
        }}
        onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
        onKeyDown={(event) => {
          if (!shouldSendChatKey({ ...event, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode }, composing.current)) return
          event.preventDefault()
          if (canSend) onSend()
        }} />
      <button type="button" className="chat-composer__attach" disabled={busy || attachments.length >= CHAT_ATTACHMENT_MAX_FILES} onClick={() => pickerRef.current?.click()}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21 11-8.5 8.5a6 6 0 0 1-8.5-8.5L13 2.5a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>
        {t('chat.addFiles')}
      </button>
      <button type="button" className="chat-composer__send" disabled={!canSend} onClick={onSend}
        aria-label={t(busy ? 'chat.sending' : 'chat.send')} aria-busy={busy} title={t('chat.send')}>
        {busy ? <svg className="chat-composer__spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity=".3" /><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2" /></svg> :
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>}
      </button>
    </div>
    <p className="chat-composer__hint" id={hintId}>{t('chat.composerHint')}</p>
    <details className="chat-composer__formats">
      <summary>{t('chat.attachmentFormats')}</summary>
      <p className="chat-composer__hint">{t('chat.attachmentHint')}</p>
    </details>
  </div>
}

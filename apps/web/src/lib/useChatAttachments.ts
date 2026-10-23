import { useEffect, useRef, useState } from 'react'
import type { ChatAttachmentView } from '@marketing-agent/shared'
import { api } from './api.ts'
import { useI18n } from './i18n.tsx'
import { validateChatFiles } from './chat-attachments.ts'

export interface DraftChatAttachment {
  localId: number
  scope: string
  conversationId: string
  file: File
  previewUrl: string | null
  status: 'uploading' | 'ready' | 'error'
  attachment?: ChatAttachmentView
  error?: string
}

export function useChatAttachments(companyId: string, conversationId: string | null) {
  const { t, translateError } = useI18n()
  const scope = `${companyId}:${conversationId ?? ''}`
  const currentScope = useRef(scope)
  currentScope.current = scope
  const entries = useRef<DraftChatAttachment[]>([])
  const controllers = useRef(new Map<number, AbortController>())
  const sequence = useRef(0)
  const [files, setFiles] = useState<DraftChatAttachment[]>([])
  const [error, setError] = useState<string | null>(null)

  function update(next: DraftChatAttachment[]) {
    entries.current = next
    setFiles(next)
  }

  function dispose(file: DraftChatAttachment, removeRemote: boolean) {
    controllers.current.get(file.localId)?.abort()
    controllers.current.delete(file.localId)
    if (file.previewUrl) URL.revokeObjectURL(file.previewUrl)
    if (removeRemote && file.attachment) void api.removeChatAttachment(file.conversationId, file.attachment.id).catch(() => undefined)
  }

  useEffect(() => {
    setError(null)
    setFiles(entries.current.filter((entry) => entry.scope === scope))
    return () => {
      const previous = entries.current.filter((entry) => entry.scope === scope)
      for (const entry of previous) dispose(entry, true)
      entries.current = entries.current.filter((entry) => entry.scope !== scope)
    }
  }, [scope])

  async function upload(entry: DraftChatAttachment) {
    const controller = new AbortController()
    controllers.current.set(entry.localId, controller)
    try {
      const { attachment } = await api.uploadChatAttachment(entry.conversationId, entry.file, controller.signal)
      if (currentScope.current !== entry.scope || !entries.current.some((file) => file.localId === entry.localId)) {
        void api.removeChatAttachment(entry.conversationId, attachment.id).catch(() => undefined)
        return
      }
      update(entries.current.map((file) => file.localId === entry.localId ? { ...file, status: 'ready', attachment, error: undefined } : file))
    } catch (cause) {
      if (controller.signal.aborted || currentScope.current !== entry.scope) return
      update(entries.current.map((file) => file.localId === entry.localId ? { ...file, status: 'error', error: translateError(cause) } : file))
    } finally { controllers.current.delete(entry.localId) }
  }

  function add(incoming: readonly File[]) {
    if (!conversationId || !incoming.length) return
    const existing = entries.current.filter((file) => file.scope === scope)
    const invalid = validateChatFiles(existing.map((entry) => entry.file), incoming)
    if (invalid) {
      const messages = { count: 'chat.attachmentsCount', type: 'chat.attachmentsType', size: 'chat.attachmentsSize', total: 'chat.attachmentsTotal' } as const
      setError(t(messages[invalid])); return
    }
    setError(null)
    const added: DraftChatAttachment[] = incoming.map((file) => ({
      localId: ++sequence.current, scope, conversationId, file,
      previewUrl: /\.(png|jpe?g|webp)$/i.test(file.name) ? URL.createObjectURL(file) : null,
      status: 'uploading',
    }))
    update([...existing, ...added])
    for (const entry of added) void upload(entry)
  }

  function remove(localId: number) {
    const entry = entries.current.find((file) => file.localId === localId && file.scope === scope)
    if (!entry) return
    dispose(entry, true)
    update(entries.current.filter((file) => file.localId !== localId))
    setError(null)
  }

  function retry(localId: number) {
    const entry = entries.current.find((file) => file.localId === localId && file.scope === scope)
    if (!entry || entry.status !== 'error') return
    update(entries.current.map((file) => file.localId === localId ? { ...file, status: 'uploading', error: undefined } : file))
    void upload(entry)
  }

  function clearSent() {
    if (currentScope.current !== scope) return
    for (const file of entries.current) dispose(file, false)
    update([])
    setError(null)
  }

  return { files: files.filter((file) => file.scope === scope), error, add, remove, retry, clearSent }
}

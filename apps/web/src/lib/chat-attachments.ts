import {
  CHAT_ATTACHMENT_ACCEPT, CHAT_ATTACHMENT_MAX_BYTES, CHAT_ATTACHMENT_MAX_FILES,
  CHAT_ATTACHMENT_TOTAL_BYTES, CHAT_IMAGE_MAX_BYTES,
} from '@marketing-agent/shared'

export type AttachmentSelectionError = 'count' | 'type' | 'size' | 'total'

/** Validate a whole selection before accepting any of it, including rapid paste/pick events. */
export function validateChatFiles(existing: readonly { size: number }[], incoming: readonly { name: string; size: number }[]): AttachmentSelectionError | null {
  if (existing.length + incoming.length > CHAT_ATTACHMENT_MAX_FILES) return 'count'
  const extensions = new Set(CHAT_ATTACHMENT_ACCEPT.split(','))
  for (const file of incoming) {
    const extension = `.${file.name.toLowerCase().split('.').pop()}`
    if (!extensions.has(extension)) return 'type'
    const image = ['.png', '.jpg', '.jpeg', '.webp'].includes(extension)
    if (!file.size || file.size > (image ? CHAT_IMAGE_MAX_BYTES : CHAT_ATTACHMENT_MAX_BYTES)) return 'size'
  }
  if ([...existing, ...incoming].reduce((sum, file) => sum + file.size, 0) > CHAT_ATTACHMENT_TOTAL_BYTES) return 'total'
  return null
}

export const CHAT_ATTACHMENT_MAX_FILES = 5
export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const CHAT_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024
export const CHAT_ATTACHMENT_ACCEPT = '.pdf,.docx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp'

export interface ChatAttachmentView {
  readonly id: string
  readonly filename: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly url: string
}

export function chatAttachmentView(file: {
  id: string; conversationId: string; filename: string; mimeType: string; sizeBytes: number
}): ChatAttachmentView {
  return {
    id: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    url: `/api/conversations/${encodeURIComponent(file.conversationId)}/attachments/${encodeURIComponent(file.id)}`,
  }
}

export interface LlmImage {
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  /** Base64 image bytes; never a remote URL or a local filesystem path. */
  readonly data: string
}

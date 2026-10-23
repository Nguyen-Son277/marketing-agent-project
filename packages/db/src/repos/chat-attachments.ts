import { AppError, newId, nowIso, notFound } from '@marketing-agent/shared'
import type { Database } from '../database.ts'

export interface ChatAttachmentRecord {
  id: string
  companyId: string
  conversationId: string
  userId: string
  messageId: string | null
  filename: string
  mimeType: string
  sizeBytes: number
  extractedText: string | null
  createdAt: string
}

const COLUMNS = `id, company_id AS companyId, conversation_id AS conversationId,
  user_id AS userId, message_id AS messageId, filename, mime_type AS mimeType,
  size_bytes AS sizeBytes, extracted_text AS extractedText, created_at AS createdAt`

export class ChatAttachmentsRepo {
  constructor(private readonly db: Database) {}

  create(input: {
    companyId: string; conversationId: string; userId: string
    filename: string; mimeType: string; bytes: Buffer; extractedText: string | null
  }): ChatAttachmentRecord {
    const conversation = this.db.get('SELECT id FROM conversations WHERE id = ? AND company_id = ?', [input.conversationId, input.companyId])
    if (!conversation) throw notFound('Không tìm thấy cuộc trao đổi')
    const id = newId()
    this.db.run(`INSERT INTO chat_attachments
      (id, company_id, conversation_id, user_id, filename, mime_type, size_bytes, bytes, extracted_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.companyId, input.conversationId, input.userId, input.filename, input.mimeType, input.bytes.length, input.bytes, input.extractedText, nowIso()])
    return this.find(id, input.companyId, input.conversationId)!
  }

  find(id: string, companyId: string, conversationId: string): ChatAttachmentRecord | undefined {
    return this.db.get(`SELECT ${COLUMNS} FROM chat_attachments WHERE id = ? AND company_id = ? AND conversation_id = ?`, [id, companyId, conversationId])
  }

  readBytes(id: string, companyId: string, conversationId: string): Buffer {
    const row = this.db.get<{ bytes: Buffer }>('SELECT bytes FROM chat_attachments WHERE id = ? AND company_id = ? AND conversation_id = ?', [id, companyId, conversationId])
    if (!row) throw notFound('Không tìm thấy tệp đính kèm')
    return row.bytes
  }

  pending(ids: readonly string[], companyId: string, conversationId: string, userId: string): ChatAttachmentRecord[] {
    return ids.map((id) => {
      const file = this.find(id, companyId, conversationId)
      if (!file || file.userId !== userId || file.messageId !== null) throw notFound('Tệp đính kèm không tồn tại hoặc đã được gửi')
      return file
    })
  }

  claim(ids: readonly string[], companyId: string, conversationId: string, userId: string, messageId: string): void {
    for (const id of ids) {
      const result = this.db.run(`UPDATE chat_attachments SET message_id = ?
        WHERE id = ? AND company_id = ? AND conversation_id = ? AND user_id = ? AND message_id IS NULL`,
      [messageId, id, companyId, conversationId, userId])
      if (result.changes !== 1) throw new AppError('conflict', 'Tệp đã được gửi trong một tin nhắn khác')
    }
  }

  removePending(id: string, companyId: string, conversationId: string, userId: string): void {
    this.db.run('DELETE FROM chat_attachments WHERE id = ? AND company_id = ? AND conversation_id = ? AND user_id = ? AND message_id IS NULL', [id, companyId, conversationId, userId])
  }

  purgePending(companyId: string): void {
    this.db.run('DELETE FROM chat_attachments WHERE company_id = ? AND message_id IS NULL AND created_at < ?', [companyId, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()])
  }
}

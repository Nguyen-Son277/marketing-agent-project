import { describe, expect, it } from 'vitest'
import { validateChatFiles } from '../src/lib/chat-attachments.ts'
import { sendMessageSchema } from '@marketing-agent/shared'

const MiB = 1024 * 1024
describe('chat attachment selections', () => {
  it('accepts supported text documents and images, case-insensitively', () => {
    for (const name of ['brief.pdf', 'brief.docx', 'note.TXT', 'guide.md', 'report.csv', 'data.json', 'shot.PNG', 'photo.jpeg', 'photo.jpg', 'banner.webp']) {
      expect(validateChatFiles([], [{ name, size: 128 }])).toBeNull()
    }
  })
  it('enforces empty/type/per-file/image/aggregate limits including already queued files', () => {
    expect(validateChatFiles([], [{ name: 'vector.svg', size: 10 }])).toBe('type')
    expect(validateChatFiles([], [{ name: 'empty.txt', size: 0 }])).toBe('size')
    expect(validateChatFiles([], [{ name: 'huge.pdf', size: 10 * MiB + 1 }])).toBe('size')
    expect(validateChatFiles([], [{ name: 'large.png', size: 5 * MiB + 1 }])).toBe('size')
    expect(validateChatFiles(Array.from({ length: 5 }, () => ({ size: 1 })), [{ name: 'sixth.txt', size: 1 }])).toBe('count')
    expect(validateChatFiles([{ size: 15 * MiB }], [{ name: 'other.pdf', size: 6 * MiB }])).toBe('total')
  })
  it('requires text or attachment IDs and rejects duplicate or excess references', () => {
    const id = '3f362946-9a52-441f-a160-a0594a7b335b'
    expect(sendMessageSchema.safeParse({ attachmentIds: [id] }).success).toBe(true)
    expect(sendMessageSchema.safeParse({ content: '   ' }).success).toBe(false)
    expect(sendMessageSchema.safeParse({ attachmentIds: [id, id] }).success).toBe(false)
    expect(sendMessageSchema.safeParse({ attachmentIds: ['../../private'] }).success).toBe(false)
  })
})

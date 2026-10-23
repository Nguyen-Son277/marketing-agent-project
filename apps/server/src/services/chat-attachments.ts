import { CHAT_IMAGE_MAX_BYTES, validation } from '@marketing-agent/shared'
import { extractKnowledgeFile, parseKnowledgeUpload } from './knowledge-upload.ts'
import type { IncomingMessage } from 'node:http'

/** Check the container and dimensions before treating an upload as an inline image. */
export function imageMimeType(filename: string, bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  const ext = filename.toLowerCase().split('.').pop()
  if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext ?? '')) return null
  if (bytes.length > CHAT_IMAGE_MAX_BYTES) throw validation('Ảnh không được lớn hơn 5 MiB')
  let width = 0, height = 0
  let mime: 'image/png' | 'image/jpeg' | 'image/webp'
  if (ext === 'png' && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    mime = 'image/png'; width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20)
  } else if ((ext === 'jpg' || ext === 'jpeg') && bytes[0] === 255 && bytes[1] === 216) {
    mime = 'image/jpeg'
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) break
      while (bytes[offset] === 255) offset++
      if (offset + 3 > bytes.length) break
      const marker = bytes[offset++]!
      if (marker === 0xda || marker === 0xd9) break
      const length = bytes.readUInt16BE(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break
      }
      offset += length
    }
  } else if (ext === 'webp' && bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    mime = 'image/webp'
    const kind = bytes.toString('ascii', 12, 16)
    if (kind === 'VP8X') {
      width = 1 + bytes.readUIntLE(24, 3); height = 1 + bytes.readUIntLE(27, 3)
    } else if (kind === 'VP8 ' && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff
    } else if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21)
      width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1
    }
  } else throw validation('Nội dung ảnh không khớp định dạng PNG, JPG hoặc WebP')
  if (!width || !height || width > 16_384 || height > 16_384 || width * height > 24_000_000) throw validation('Ảnh không hợp lệ hoặc vượt quá 24 megapixel. Hãy giảm kích thước ảnh.')
  return mime
}

export async function readChatUpload(req: IncomingMessage): Promise<{
  filename: string; mimeType: string; bytes: Buffer; extractedText: string | null
}> {
  const file = await parseKnowledgeUpload(req)
  const imageType = imageMimeType(file.filename, file.bytes)
  if (imageType) return { ...file, mimeType: imageType, extractedText: null }
  const extension = file.filename.toLowerCase().split('.').pop()
  const textFile = extension === 'csv' || extension === 'json'
  const extracted = await extractKnowledgeFile(textFile ? 'attachment.txt' : file.filename, file.bytes)
  // Refuse to silently omit part of a document from the analysis.
  if (extracted.content.length > 40_000) throw validation('Tài liệu vượt quá 40.000 ký tự văn bản. Hãy chia thành các tệp nhỏ hơn để Leader đọc đầy đủ.')
  return { ...file, mimeType: extension === 'csv' ? 'text/csv' : extension === 'json' ? 'application/json' : extracted.mimeType, extractedText: extracted.content }
}

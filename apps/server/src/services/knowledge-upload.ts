import type { IncomingMessage } from 'node:http'
import { TextDecoder } from 'node:util'
import Busboy from 'busboy'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { AppError, KB_CATEGORY_CODES } from '@marketing-agent/shared'

export const KNOWLEDGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024
export const KNOWLEDGE_UPLOAD_MAX_CHARS = 2_000_000
const MAX_FIELD_BYTES = 16 * 1024
const MAX_FIELDS = 12
const MAX_PARTS = 14
const EXTRACT_TIMEOUT_MS = 15_000
const CATEGORIES = new Set<string>(KB_CATEGORY_CODES)

/** A stable error shape suitable for returning from HTTP handlers. */
export class KnowledgeUploadValidationError extends AppError {
  constructor(message: string) {
    super('validation', message)
    this.name = 'KnowledgeUploadValidationError'
  }
}

function invalid(message: string): never {
  throw new KnowledgeUploadValidationError(message)
}

function safeFilename(input: string): string {
  // Do not accept separators or drive/UNC path markers; normalize only basename after validation.
  if (!input || input.length > 255 || /[/\\\0-\x1f\x7f]/.test(input) || /^[a-zA-Z]:/.test(input) || input === '.' || input === '..') {
    return invalid('Invalid filename')
  }
  return input
}

function parseTags(raw: string | undefined): string[] {
  if (!raw) return []
  let result: unknown
  try {
    result = JSON.parse(raw)
  } catch {
    result = raw.split(',').map((tag) => tag.trim()).filter(Boolean)
  }
  if (!Array.isArray(result) || result.length > 20 || result.some((tag) => typeof tag !== 'string' || tag.length > 100)) {
    return invalid('Invalid tags field')
  }
  return result.map((tag) => tag.trim()).filter(Boolean)
}

export async function parseKnowledgeUpload(req: IncomingMessage): Promise<{
  filename: string
  mimeType: string
  bytes: Buffer
  category?: string
  title?: string
  tags: string[]
}> {
  return await new Promise((resolve, reject) => {
    let settled = false
    let fileCount = 0
    let fileBytes = 0
    let filename = ''
    let mimeType = ''
    let buffer: Buffer | undefined
    let category: string | undefined
    let title: string | undefined
    let tags: string[] = []
    const finishError = (err: unknown) => {
      if (settled) return
      settled = true
      reject(err instanceof KnowledgeUploadValidationError ? err : new KnowledgeUploadValidationError('Malformed multipart upload'))
    }
    let parser: ReturnType<typeof Busboy>
    try {
      parser = Busboy({
        headers: req.headers,
        preservePath: true,
        defParamCharset: 'utf8',
        limits: { fileSize: KNOWLEDGE_UPLOAD_MAX_BYTES, files: 1, fields: MAX_FIELDS, parts: MAX_PARTS, fieldSize: MAX_FIELD_BYTES, headerPairs: 100 },
      })
    } catch {
      finishError(new KnowledgeUploadValidationError('Expected multipart/form-data'))
      return
    }

    parser.on('file', (fieldName, stream, info) => {
      fileCount += 1
      if (fieldName !== 'file' || fileCount > 1) {
        stream.resume()
        finishError(new KnowledgeUploadValidationError('Exactly one file field named file is required'))
        return
      }
      try { filename = safeFilename(info.filename ?? '') } catch (error) { stream.resume(); finishError(error); return }
      mimeType = info.mimeType.toLowerCase()
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => {
        if (settled) return
        fileBytes += chunk.length
        if (fileBytes > KNOWLEDGE_UPLOAD_MAX_BYTES) {
          finishError(new KnowledgeUploadValidationError('File exceeds 10 MiB limit'))
          stream.resume()
          return
        }
        chunks.push(chunk)
      })
      stream.on('limit', () => finishError(new KnowledgeUploadValidationError('File exceeds 10 MiB limit')))
      stream.on('error', finishError)
      stream.on('end', () => { buffer = Buffer.concat(chunks) })
    })
    parser.on('field', (name, value, info) => {
      if (info.valueTruncated) { finishError(new KnowledgeUploadValidationError('Multipart field too large')); return }
      if (name === 'category') category = value
      else if (name === 'title') title = value
      else if (name === 'tags') {
        try { tags = parseTags(value) } catch (error) { finishError(error) }
      } else finishError(new KnowledgeUploadValidationError(`Unexpected field: ${name}`))
    })
    parser.on('filesLimit', () => finishError(new KnowledgeUploadValidationError('Only one file is allowed')))
    parser.on('fieldsLimit', () => finishError(new KnowledgeUploadValidationError('Too many multipart fields')))
    parser.on('partsLimit', () => finishError(new KnowledgeUploadValidationError('Too many multipart parts')))
    parser.on('error', finishError)
    parser.on('close', () => {
      if (settled) return
      if (fileCount !== 1 || !buffer?.length) { finishError(new KnowledgeUploadValidationError('A non-empty file is required')); return }
      if (category !== undefined && !CATEGORIES.has(category)) { finishError(new KnowledgeUploadValidationError('Invalid category')); return }
      if (title !== undefined && title.length > 200) { finishError(new KnowledgeUploadValidationError('Title is too long')); return }
      settled = true
      resolve({ filename, mimeType, bytes: buffer, ...(category ? {category} : {}), ...(title ? { title } : {}), tags })
    })
    let received = 0
    req.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (received > KNOWLEDGE_UPLOAD_MAX_BYTES + 256 * 1024) {
        finishError(new KnowledgeUploadValidationError('Multipart request exceeds size limit'))
        req.unpipe(parser)
        parser.destroy()
        req.resume()
      }
    })
    req.on('aborted', () => finishError(new KnowledgeUploadValidationError('Upload was interrupted')))
    req.on('error', finishError)
    req.pipe(parser)
  })
}

/** Bound OOXML expansion before handing the archive to Mammoth. No disk extraction. */
function validateDocxArchive(bytes: Buffer): void {
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return invalid('DOCX archive is corrupt')
  const entries = bytes.readUInt16LE(eocd + 10)
  let offset = bytes.readUInt32LE(eocd + 16)
  if (entries > 2000 || entries === 0) return invalid('DOCX archive has too many entries')
  let expanded = 0
  let hasDocument = false
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) return invalid('DOCX archive directory is invalid')
    const flags = bytes.readUInt16LE(offset + 8)
    const unpacked = bytes.readUInt32LE(offset + 24)
    const nameSize = bytes.readUInt16LE(offset + 28)
    const extraSize = bytes.readUInt16LE(offset + 30)
    const commentSize = bytes.readUInt16LE(offset + 32)
    const name = bytes.subarray(offset + 46, offset + 46 + nameSize).toString('utf8')
    if (flags & 1 || unpacked === 0xffffffff) return invalid('Encrypted or ZIP64 DOCX is unsupported')
    if (name.startsWith('/') || name.split('/').includes('..') || name.includes('\\\\')) return invalid('Unsafe DOCX archive path')
    if (/vbaProject\.bin$/i.test(name)) return invalid('Macro-enabled files are unsupported')
    if (name === 'word/document.xml') hasDocument = true
    expanded += unpacked
    if (expanded > 32 * 1024 * 1024) return invalid('DOCX expanded content exceeds 32 MiB')
    offset += 46 + nameSize + extraSize + commentSize
  }
  if (!hasDocument) return invalid('File is not a Word DOCX document')
}

function signature(bytes: Buffer, filename: string): 'pdf' | 'docx' | 'text' {
  const extension = filename.toLowerCase().split('.').pop()
  if (extension === 'pdf') {
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') return invalid('PDF signature does not match filename')
    return 'pdf'
  }
  if (extension === 'docx') {
    // DOCX is an OOXML ZIP archive.
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || ![0x03, 0x05, 0x07].includes(bytes[2] ?? -1) || ![0x04, 0x06, 0x08].includes(bytes[3] ?? -1)) return invalid('DOCX signature does not match filename')
    return 'docx'
  }
  if (extension === 'txt' || extension === 'md') {
    // Reject binary payloads and require well-formed UTF-8.
    if (bytes.includes(0)) return invalid('Text file is not valid UTF-8')
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return invalid('Text file is not valid UTF-8') }
    return 'text'
  }
  return invalid('Only PDF, DOCX, TXT, and MD files are supported')
}

export async function extractKnowledgeFile(filename: string, bytes: Buffer): Promise<{ content: string; mimeType: string }> {
  if (!bytes.length || bytes.length > KNOWLEDGE_UPLOAD_MAX_BYTES) return invalid('File must be non-empty and no larger than 10 MiB')
  const kind = signature(bytes, filename)
  let extracted: string
  const task = (async () => {
    if (kind === 'text') extracted = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    else if (kind === 'pdf') {
      const parser = new PDFParse({ data: new Uint8Array(bytes) })
      try {
        const parsed = await parser.getText()
        extracted = parsed.pages.map((page) => page.text).join('\n\n')
        if (!parsed.total || parsed.total < 1) return invalid('PDF contains no pages')
      } finally { await parser.destroy() }
    } else {
      validateDocxArchive(bytes)
      const result = await mammoth.extractRawText({ buffer: bytes })
      extracted = result.value
    }
  })()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([task, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new KnowledgeUploadValidationError('Document extraction timed out')), EXTRACT_TIMEOUT_MS); timer.unref?.() })])
  } catch (error) {
    if (error instanceof KnowledgeUploadValidationError) throw error
    return invalid('Unable to parse document; file may be corrupt, encrypted, or unsupported')
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (!extracted!.trim()) return invalid('Document contains no extractable text (scanned documents are not supported)')
  if (extracted!.length > KNOWLEDGE_UPLOAD_MAX_CHARS) return invalid('Extracted text exceeds 2 million characters')
  const mimeType = kind === 'pdf' ? 'application/pdf' : kind === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : filename.toLowerCase().endsWith('.md') ? 'text/markdown' : 'text/plain'
  return { content: extracted!, mimeType }
}

export { KnowledgeUploadValidationError as KnowledgeUploadError }

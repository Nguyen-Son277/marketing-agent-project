import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import PDFDocument from 'pdfkit'
import { Document, Packer, Paragraph } from 'docx'
import { extractKnowledgeFile, KnowledgeUploadValidationError, parseKnowledgeUpload } from '../src/services/knowledge-upload.ts'

function multipart(parts: Array<{ name: string; value: string } | { name: string; filename: string; contentType: string; bytes: Buffer }>): Readable & { headers: Record<string, string> } {
  const boundary = 'unit-test-boundary'
  const chunks: Buffer[] = []
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`))
    if ('filename' in part) {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.contentType}\r\n\r\n`), part.bytes, Buffer.from('\r\n'))
    } else chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  const req = Readable.from(chunks) as Readable & { headers: Record<string, string> }
  req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` }
  return req
}

async function pdfFixture(text: string): Promise<Buffer> {
  const doc = new PDFDocument()
  const chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
  doc.text(text)
  doc.end()
  return done
}

async function docxFixture(text: string): Promise<Buffer> {
  return Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(text)] }] }))
}

const fields = [
  { name: 'category', value: '10-brand' },
  { name: 'title', value: 'Brand guide' },
  { name: 'tags', value: '["voice","brand"]' },
]

describe('knowledge upload parsing', () => {
  it('streams and parses one file with metadata', async () => {
    const content = Buffer.from('# Hello\nworld')
    const parsed = await parseKnowledgeUpload(multipart([...fields, { name: 'file', filename: 'guide.md', contentType: 'text/markdown', bytes: content }]))
    expect(parsed).toMatchObject({ filename: 'guide.md', category: '10-brand', title: 'Brand guide', tags: ['voice', 'brand'], bytes: content })
    expect(await extractKnowledgeFile(parsed.filename, parsed.bytes)).toEqual({ content: '# Hello\nworld', mimeType: 'text/markdown' })
  })

  it('extracts valid PDF and DOCX fixture text', async () => {
    const pdfBytes = await pdfFixture('PDF extract test')
    const docxBytes = await docxFixture('DOCX extract test')
    expect((await extractKnowledgeFile('fixture.pdf', pdfBytes)).content).toContain('PDF extract test')
    expect((await extractKnowledgeFile('fixture.docx', docxBytes)).content).toContain('DOCX extract test')
  })

  it('rejects invalid metadata, path-like filenames, and excess size', async () => {
    await expect(parseKnowledgeUpload(multipart([{ name: 'category', value: 'bogus' }, { name: 'file', filename: 'x.txt', contentType: 'text/plain', bytes: Buffer.from('x') }]))).rejects.toBeInstanceOf(KnowledgeUploadValidationError)
    await expect(parseKnowledgeUpload(multipart([...fields, { name: 'file', filename: '../x.txt', contentType: 'text/plain', bytes: Buffer.from('x') }]))).rejects.toBeInstanceOf(KnowledgeUploadValidationError)
    await expect(extractKnowledgeFile('x.txt', Buffer.alloc(10 * 1024 * 1024 + 1))).rejects.toBeInstanceOf(KnowledgeUploadValidationError)
  })

  it('rejects a streamed oversized request and multiple files', async () => {
    await expect(parseKnowledgeUpload(multipart([...fields, {name:'file',filename:'large.txt',contentType:'text/plain',bytes:Buffer.alloc(10*1024*1024+1,65)}]))).rejects.toBeInstanceOf(KnowledgeUploadValidationError)
    await expect(parseKnowledgeUpload(multipart([...fields, {name:'file',filename:'one.txt',contentType:'text/plain',bytes:Buffer.from('one')}, {name:'file',filename:'two.txt',contentType:'text/plain',bytes:Buffer.from('two')}]))).rejects.toBeInstanceOf(KnowledgeUploadValidationError)
  })

  it('preserves Vietnamese names/text and rejects PDFs without text', async () => {
    const bytes = Buffer.from('Nội dung kiến thức tiếng Việt đầy đủ dấu.')
    const parsed = await parseKnowledgeUpload(multipart([...fields, {name:'file',filename:'chính-sách.txt',contentType:'text/plain',bytes}]))
    expect(parsed.filename).toBe('chính-sách.txt')
    expect((await extractKnowledgeFile(parsed.filename,parsed.bytes)).content).toContain('tiếng Việt')
    const doc = new PDFDocument()
    const chunks:Buffer[] = []
    const done = new Promise<Buffer>((resolve) => {doc.on('data',(chunk:Buffer)=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)))})
    doc.rect(10,10,100,100).fill('blue')
    doc.end()
    await expect(extractKnowledgeFile('scan.pdf',await done)).rejects.toBeInstanceOf(KnowledgeUploadValidationError)
    await expect(extractKnowledgeFile('not-word.docx',Buffer.from('PK\x03\x04not-word'))).rejects.toBeInstanceOf(KnowledgeUploadValidationError)
  })

  it('rejects mismatched signatures, invalid UTF-8, and empty extraction', async () => {
    await expect(extractKnowledgeFile('x.pdf', Buffer.from('not a pdf'))).rejects.toBeInstanceOf(KnowledgeUploadValidationError)
    await expect(extractKnowledgeFile('x.txt', Buffer.from([0xff, 0xfe]))).rejects.toBeInstanceOf(KnowledgeUploadValidationError)
    await expect(extractKnowledgeFile('x.md', Buffer.from('  '))).rejects.toBeInstanceOf(KnowledgeUploadValidationError)
  })
})

declare module 'node:stream' {
  interface Readable { headers?: Record<string, string> }
}

import type { IncomingMessage } from 'node:http'
import { createWriteStream } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import Busboy from 'busboy'
import { SOCIAL_ASSET_MAX_BYTES, SOCIAL_ASSET_TYPES, validation } from '@marketing-agent/shared'

/** Stream media to disk; do not buffer large YouTube/TikTok videos in SQLite. */
export async function receiveBrowserAsset(
  req: IncomingMessage,
  target: string,
): Promise<{ filename: string; mimeType: string; sizeBytes: number }> {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  const temporary = `${target}.part`
  let filename = '',
    mimeType = '',
    truncated = false,
    count = 0
  let writing: Promise<void> = Promise.resolve()
  try {
    await new Promise<void>((resolve, reject) => {
      let parser: ReturnType<typeof Busboy>
      try {
        parser = Busboy({
          headers: req.headers,
          limits: { files: 1, fields: 0, parts: 2, fileSize: SOCIAL_ASSET_MAX_BYTES },
        })
      } catch {
        reject(validation('Cần gửi một tệp bằng multipart/form-data'))
        return
      }
      parser.on('file', (_name, file, info) => {
        count++
        filename = info.filename ?? ''
        const ext = filename.toLowerCase().split('.').pop() ?? ''
        mimeType = SOCIAL_ASSET_TYPES[ext] ?? ''
        if (!mimeType || filename.length > 255 || !filename || /[/\\\x00-\x1f\x7f]/.test(filename)) {
          file.resume()
          reject(validation('Chỉ nhận PNG/JPG/WebP/GIF, MP4/MOV/WebM với tên tệp hợp lệ'))
          return
        }
        file.once('limit', () => {
          truncated = true
        })
        writing = pipeline(file, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
        writing.catch(reject)
      })
      parser.once('filesLimit', () => reject(validation('Mỗi lần chỉ gửi một tệp')))
      parser.once('partsLimit', () => reject(validation('Mỗi lần chỉ gửi một tệp')))
      parser.once('fieldsLimit', () => reject(validation('Không nhận trường bổ sung')))
      parser.once('error', () => reject(validation('Tệp tải lên không hợp lệ')))
      req.once('aborted', () => {
        parser.destroy()
        reject(validation('Tải tệp đã bị ngắt'))
      })
      parser.once('close', () => resolve())
      req.pipe(parser)
    })
    await writing
    if (count !== 1 || truncated) throw validation('Tệp rỗng hoặc vượt quá 256 MiB')
    const sizeBytes = (await stat(temporary)).size
    if (!sizeBytes) throw validation('Tệp rỗng')
    const file = await open(temporary, 'r')
    const header = Buffer.alloc(32)
    try {
      await file.read(header, 0, header.length, 0)
    } finally {
      await file.close()
    }
    const valid =
      mimeType === 'image/png'
        ? header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mimeType === 'image/jpeg'
          ? header[0] === 255 && header[1] === 216
          : mimeType === 'image/webp'
            ? header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP'
            : mimeType === 'image/gif'
              ? /^GIF8[79]a$/.test(header.toString('ascii', 0, 6))
              : mimeType === 'video/webm'
                ? header.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))
                : header.toString('ascii', 4, 8) === 'ftyp'
    if (!valid) throw validation('Nội dung tệp không khớp định dạng ảnh/video')
    await rename(temporary, target)
    return { filename, mimeType, sizeBytes }
  } catch (error) {
    await writing.catch(() => {})
    await rm(temporary, { force: true })
    throw error
  }
}

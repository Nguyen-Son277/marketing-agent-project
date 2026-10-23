import { createServer, type IncomingMessage } from 'node:http'
import { timingSafeEqual, randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, rm, stat, rename } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { chromium } from 'playwright-core'
import {
  AppError,
  SOCIAL_ASSET_MAX_BYTES,
  SOCIAL_ASSET_TYPES,
  browserModeSchema,
  validation,
  type BrowserHumanInput,
} from '@marketing-agent/shared'
import { BrowserWorkerController } from './controller.ts'

const exec = promisify(execFile)
const token = process.env.BROWSER_WORKER_TOKEN ?? ''
if (token.length < 32) throw new Error('BROWSER_WORKER_TOKEN phải có ít nhất 32 ký tự')
const profile = process.env.BROWSER_PROFILE_DIR ?? '/home/node/profile'
const uploads = process.env.BROWSER_UPLOAD_DIR ?? '/tmp/browser-uploads'
await mkdir(profile, { recursive: true, mode: 0o700 })
await mkdir(uploads, { recursive: true, mode: 0o700 })
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.BROWSER_EXECUTABLE ?? '/usr/bin/chromium',
  headless: false,
  viewport: { width: 1400, height: 900 },
  acceptDownloads: false,
  args: [
    '--disable-dev-shm-usage',
    '--disable-save-password-bubble',
    '--no-first-run',
    '--window-size=1440,1000',
  ],
})
const controller = new BrowserWorkerController(context, {
  async screen() {
    return (
      await exec('import', ['-window', 'root', 'png:-'], {
        encoding: 'buffer',
        maxBuffer: 12 * 1024 * 1024,
        timeout: 5000,
      })
    ).stdout
  },
  async input(input: BrowserHumanInput) {
    if (input.operation === 'click')
      await exec('xdotool', ['mousemove', '--sync', String(input.x), String(input.y), 'click', '1'], {
        timeout: 3000,
      })
    else if (input.operation === 'scroll')
      await exec('xdotool', ['click', '--repeat', '4', input.direction === 'up' ? '4' : '5'], {
        timeout: 3000,
      })
    else if (input.operation === 'key')
      await exec('xdotool', ['key', '--clearmodifiers', input.key], { timeout: 3000 })
    else if (input.operation === 'text') {
      await new Promise<void>((resolve, reject) => {
        const clip = spawn('xclip', ['-selection', 'clipboard'], { stdio: ['pipe', 'ignore', 'ignore'] })
        clip.once('error', reject)
        clip.once('exit', (code) => (code === 0 ? resolve() : reject(new Error('Clipboard unavailable'))))
        clip.stdin.end(input.text)
      })
      await exec('xdotool', ['key', '--clearmodifiers', 'ctrl+v'], { timeout: 3000 })
    }
  },
})
await controller.init()
async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 512000) throw validation('Nội dung yêu cầu quá lớn')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString())
  } catch {
    throw validation('JSON không hợp lệ')
  }
}
function authorized(value: string | undefined): boolean {
  const expected = Buffer.from(`Bearer ${token}`),
    actual = Buffer.from(value ?? '')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  const send = (status: number, data: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }
  if (!authorized(req.headers.authorization)) {
    send(401, { error: 'Unauthorized' })
    return
  }
  try {
    const path = new URL(req.url ?? '/', 'http://worker').pathname
    if (req.method === 'GET' && path === '/health') {
      send(200, controller.status())
      return
    }
    if (req.method === 'POST' && path === '/mode') {
      send(200, await controller.setMode(browserModeSchema.parse(await readJson(req)).mode))
      return
    }
    if (req.method === 'POST' && path === '/human') {
      send(200, await controller.human(await readJson(req)))
      return
    }
    if (req.method === 'POST' && path === '/agent') {
      send(200, await controller.agent(await readJson(req)))
      return
    }
    if (req.method === 'GET' && path === '/screen') {
      const bytes = await controller.screen()
      res.writeHead(200, { 'Content-Type': 'image/png' })
      res.end(bytes)
      return
    }
    const upload = /^\/uploads\/([A-Za-z0-9_-]+)$/.exec(path)
    if (req.method === 'PUT' && upload) {
      const name = decodeURIComponent(String(req.headers['x-asset-name'] ?? '')),
        type = String(req.headers['content-type'] ?? '')
      if (
        !name ||
        name === '.' ||
        name === '..' ||
        name.length > 255 ||
        /[/\\\x00-\x1f]/.test(name) ||
        !Object.values(SOCIAL_ASSET_TYPES).includes(type)
      )
        throw validation('Tệp không hợp lệ')
      const directory = join(uploads, randomUUID())
      await mkdir(directory, { mode: 0o700 })
      const target = join(directory, name),
        temporary = `${target}.part`
      let size = 0
      try {
        await pipeline(
          req,
          new Transform({
            transform(chunk, _encoding, callback) {
              size += chunk.length
              callback(size > SOCIAL_ASSET_MAX_BYTES ? validation('Tệp vượt quá 256 MiB') : null, chunk)
            },
          }),
          createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
        )
        if (!(await stat(temporary)).size) throw validation('Tệp rỗng')
        await rename(temporary, target)
        await controller.registerUpload(upload[1]!, { path: target, name, mimeType: type })
        send(200, { ok: true })
      } catch (error) {
        await rm(directory, { force: true, recursive: true })
        throw error
      }
      return
    }
    send(404, { error: 'Not found' })
  } catch (error) {
    // Never log a human input, page contents, session cookies or bearer token.
    const status = error instanceof AppError ? error.status : 400
    send(status, {
      error:
        error instanceof AppError
          ? error.message
          : 'Thao tác thất bại. Kiểm tra giao diện và chuyển sang người dùng nếu cần.',
    })
  }
})
server.requestTimeout = 5 * 60 * 1000
server.listen(
  Number(process.env.BROWSER_WORKER_PORT ?? 4090),
  process.env.BROWSER_WORKER_HOST ?? '127.0.0.1',
  () => console.log('[browser-worker] ready'),
)
let closing = false
async function close() {
  if (closing) return
  closing = true
  server.close()
  await context.close()
  process.exit(0)
}
process.on('SIGINT', () => {
  void close()
})
process.on('SIGTERM', () => {
  void close()
})

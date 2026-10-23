/// <reference lib="dom" />
import { rm } from 'node:fs/promises'
import type { BrowserContext, Locator, Page } from 'playwright-core'
import {
  browserActionSchema,
  browserHumanInputSchema,
  conflict,
  forbidden,
  isBrowserAuthTarget,
  isBrowserAccountChange,
  isBrowserUrlAllowed,
  validation,
  type BrowserAction,
  type BrowserHumanInput,
} from '@marketing-agent/shared'

interface Session {
  jobId: string
  kind: 'publish' | 'read'
  entryUrl: string
  allowedHosts: string[]
  page: Page
  blocked: boolean
}
export interface DesktopDriver {
  screen(): Promise<Buffer>
  input(input: BrowserHumanInput): Promise<void>
}

/** No shell, CDP, cookie or credentials tool is exposed to an agent. */
export class BrowserWorkerController {
  private mode: 'human' | 'agent' | 'paused' = 'human'
  private session: Session | null = null
  private tail: Promise<unknown> = Promise.resolve()
  private readonly uploads = new Map<string, { path: string; name: string; mimeType: string }>()
  constructor(
    private readonly context: BrowserContext,
    private readonly desktop: DesktopDriver,
  ) {}
  async init(): Promise<void> {
    this.context.setDefaultTimeout(8000)
    this.context.setDefaultNavigationTimeout(12000)
    await this.context.route('**/*', async (route) => {
      const session = this.session,
        request = route.request()
      if (this.mode !== 'agent' || !session) {
        await route.fallback()
        return
      }
      const url = new URL(request.url())
      if (
        (request.isNavigationRequest() &&
          (!isBrowserUrlAllowed(url.href, session.allowedHosts) ||
            isBrowserAuthTarget(url.pathname) ||
            isBrowserAccountChange(url.pathname.replace(/[/_-]/g, ' ')))) ||
        (request.method() !== 'GET' &&
          /(?:\/(?:logout|log_out|signout|signin|login|password|checkpoint)(?:[/.?]|$))/i.test(url.pathname))
      ) {
        session.blocked = true
        await route.abort('blockedbyclient')
        return
      }
      await route.fallback()
    })
    // Popups are not an escape route from the configured channel.
    this.context.on('page', (page) => {
      page.on('dialog', (dialog) => {
        void dialog.dismiss().catch(() => {})
      })
    })
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.catch(() => {}).then(work)
    this.tail = pending
    return pending
  }
  status(): Record<string, unknown> {
    return { status: 'ready', mode: this.mode, sessionActive: !!this.session, protocol: 1 }
  }
  setMode(mode: 'human' | 'agent' | 'paused'): Promise<Record<string, unknown>> {
    return this.serial(async () => {
      this.mode = mode
      this.session = null
      await this.clearUploads()
      return this.status()
    })
  }
  async screen(): Promise<Buffer> {
    if (this.mode !== 'human') throw conflict('Màn hình chỉ mở trong chế độ người dùng tiếp quản')
    return this.desktop.screen()
  }
  human(raw: unknown): Promise<Record<string, unknown>> {
    return this.serial(async () => {
      if (this.mode !== 'human')
        throw conflict('Agent đang giữ quyền điều khiển hoặc môi trường đang tạm dừng')
      const input = browserHumanInputSchema.parse(raw)
      if (input.operation === 'navigate') {
        const url = new URL(input.url)
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
          throw validation('Chỉ mở URL HTTP/HTTPS')
        const page = this.context.pages()[0] ?? (await this.context.newPage())
        await page.bringToFront()
        await page.goto(input.url, { waitUntil: 'domcontentloaded' })
      } else await this.desktop.input(input)
      return { ok: true }
    })
  }
  async registerUpload(id: string, file: { path: string; name: string; mimeType: string }): Promise<void> {
    if (this.mode !== 'agent' || !this.session) throw conflict('Chưa có tác vụ agent')
    const old = this.uploads.get(id)
    if (old) await rm(old.path, { force: true })
    this.uploads.set(id, file)
  }
  private async clearUploads(): Promise<void> {
    const files = [...this.uploads.values()]
    this.uploads.clear()
    await Promise.all(files.map((f) => rm(f.path, { force: true }).catch(() => {})))
  }
  private needsHuman(): Record<string, unknown> {
    this.mode = 'human'
    this.session = null
    return {
      needsHuman: true,
      message: 'Cần người dùng đăng nhập, xác minh hoặc kiểm tra giao diện. Agent đã dừng.',
    }
  }
  private async authenticationRequired(page: Page): Promise<boolean> {
    if (isBrowserAuthTarget(new URL(page.url()).pathname)) return true
    const fields = page.locator(
      'input[type=password], input[type=email], input[autocomplete="one-time-code"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )
    for (let i = 0; i < (await fields.count()); i++)
      if (
        await fields
          .nth(i)
          .isVisible()
          .catch(() => false)
      )
        return true
    return false
  }
  private async snapshot(session: Session): Promise<Record<string, unknown>> {
    if (session.blocked || (await this.authenticationRequired(session.page))) return this.needsHuman()
    return {
      url: session.page.url(),
      title: await session.page.title(),
      snapshot: (await session.page.locator('body').ariaSnapshot()).slice(0, 45000),
    }
  }
  private async target(page: Page, action: BrowserAction, session: Session): Promise<Locator> {
    if (!action.locator) throw validation('Cần locator gồm role/name/index lấy từ snapshot')
    if (isBrowserAuthTarget(action.locator.name) || isBrowserAccountChange(action.locator.name))
      throw forbidden('Xác thực và cài đặt tài khoản chỉ dành cho người dùng')
    const locator = page
      .getByRole(action.locator.role, { name: action.locator.name, exact: true })
      .nth(action.locator.index)
    const info = await locator.evaluate((el) => ({
      label: [
        el.textContent,
        el.getAttribute('aria-label'),
        el.getAttribute('name'),
        el.getAttribute('id'),
        el.getAttribute('autocomplete'),
      ].join(' '),
      type: el.getAttribute('type'),
      tag: el.tagName.toLowerCase(),
      href: el.getAttribute('href'),
      editable: el.getAttribute('contenteditable'),
    }))
    if (
      isBrowserAuthTarget(info.label) ||
      isBrowserAccountChange(info.label) ||
      ['password', 'email', 'tel'].includes(info.type ?? '')
    )
      throw forbidden('Trường tài khoản hoặc thao tác đăng nhập/đăng xuất bị chặn với agent')
    if (info.href) {
      const url = new URL(info.href, page.url())
      if (!isBrowserUrlAllowed(url.href, session.allowedHosts) || isBrowserAuthTarget(url.pathname))
        throw forbidden('Link nằm ngoài phạm vi kênh hoặc yêu cầu xác thực')
    }
    if (session.kind === 'read' && info.tag !== 'a')
      throw forbidden('Tác vụ chỉ đọc chỉ được mở liên kết, không bấm nút tương tác')
    if (action.operation === 'fill' && !['input', 'textarea'].includes(info.tag) && info.editable !== 'true')
      throw forbidden('Chỉ điền ô nhập nội dung')
    return locator
  }
  agent(raw: unknown): Promise<Record<string, unknown>> {
    return this.serial(async () => {
      if (this.mode !== 'agent') throw conflict('Môi trường chưa được người dùng chuyển sang chế độ agent')
      const action = browserActionSchema.parse(raw)
      const data = raw as {
        jobId?: unknown
        kind?: unknown
        entryUrl?: unknown
        allowedHosts?: unknown
        expectedText?: unknown
      }
      if (
        typeof data.jobId !== 'string' ||
        !['publish', 'read'].includes(String(data.kind)) ||
        !Array.isArray(data.allowedHosts) ||
        !data.allowedHosts.every((h) => typeof h === 'string') ||
        typeof data.entryUrl !== 'string'
      )
        throw validation('Thiếu phạm vi tác vụ')
      if (action.operation === 'start') {
        if (this.session && this.session.jobId !== data.jobId) throw conflict('Worker đang có tác vụ khác')
        if (!this.session) {
          if (
            !isBrowserUrlAllowed(data.entryUrl, data.allowedHosts) ||
            isBrowserAuthTarget(new URL(data.entryUrl).pathname)
          )
            throw forbidden('URL kênh không hợp lệ')
          const page = this.context.pages()[0] ?? (await this.context.newPage())
          const session: Session = {
            jobId: data.jobId,
            kind: data.kind as Session['kind'],
            entryUrl: data.entryUrl,
            allowedHosts: data.allowedHosts,
            page,
            blocked: false,
          }
          this.session = session
          await page.bringToFront()
          await page.goto(session.entryUrl, { waitUntil: 'domcontentloaded' }).catch((error) => {
            if (!session.blocked) throw error
          })
        }
        return this.snapshot(this.session!)
      }
      const session = this.session
      if (!session || session.jobId !== data.jobId) throw conflict('Chưa mở đúng tác vụ bằng start')
      if (action.operation === 'handoff') return this.needsHuman()
      const page = session.page
      if (session.blocked || (await this.authenticationRequired(page))) return this.needsHuman()
      if (session.kind === 'read' && ['fill', 'key', 'upload'].includes(action.operation))
        throw forbidden('Tác vụ đọc không được thay đổi nội dung')
      if (action.operation === 'navigate' || (action.operation === 'finish' && session.kind === 'publish')) {
        const url = action.operation === 'finish' ? action.resultUrl : action.url
        if (
          !url ||
          !isBrowserUrlAllowed(url, session.allowedHosts) ||
          isBrowserAuthTarget(new URL(url).pathname)
        )
          throw forbidden('URL không thuộc kênh')
        await page.goto(url, { waitUntil: 'domcontentloaded' }).catch((error) => {
          if (!session.blocked) throw error
        })
      } else if (action.operation === 'click') await (await this.target(page, action, session)).click()
      else if (action.operation === 'fill') {
        if (typeof action.text !== 'string') throw validation('Thiếu văn bản')
        await (await this.target(page, action, session)).fill(action.text)
      } else if (action.operation === 'key') {
        if (!action.key) throw validation('Thiếu phím')
        // Never press Enter on an unknown focused control.
        const active = await page
          .locator(':focus')
          .evaluate((el) => ({
            label: [
              el.textContent,
              el.getAttribute('aria-label'),
              el.getAttribute('type'),
              el.getAttribute('name'),
            ].join(' '),
            tag: el.tagName.toLowerCase(),
            editable: el.getAttribute('contenteditable'),
          }))
          .catch(() => null)
        if (
          !active ||
          isBrowserAuthTarget(active.label) ||
          (!['input', 'textarea'].includes(active.tag) && active.editable !== 'true')
        )
          throw forbidden('Phím chỉ dùng trong ô soạn nội dung đã chọn')
        await page.keyboard.press(action.key)
      } else if (action.operation === 'scroll')
        await page.mouse.wheel(0, action.direction === 'up' ? -650 : 650)
      else if (action.operation === 'upload') {
        const files = (action.assetIds ?? []).map((id) => this.uploads.get(id))
        if (!files.length || files.some((f) => !f)) throw validation('Tệp chưa được chuyển từ kho nội dung')
        await page
          .locator('input[type=file]')
          .nth(action.locator?.index ?? 0)
          .setInputFiles(files.map((f) => f!.path))
      }
      const snapshot = await this.snapshot(session)
      if (snapshot.needsHuman) return snapshot
      if (action.operation === 'finish') {
        if (session.kind === 'publish') {
          const expected =
            typeof data.expectedText === 'string' ? data.expectedText.trim().toLocaleLowerCase() : ''
          const visible = (await page.locator('body').innerText()).replace(/\s+/g, ' ').toLocaleLowerCase()
          const url = new URL(page.url()),
            entry = new URL(session.entryUrl)
          const permalink =
            (url.pathname !== '/' && url.href !== entry.href) ||
            url.searchParams.has('v') ||
            url.searchParams.has('story_fbid') ||
            url.searchParams.has('fbid')
          if (!permalink || !expected || !visible.includes(expected)) return { ...snapshot, verified: false }
        }
        this.session = null
        // Finished jobs release the worker for the next task; uploads never survive a job.
        await this.clearUploads()
        return { ...snapshot, verified: true }
      }
      return snapshot
    })
  }
}

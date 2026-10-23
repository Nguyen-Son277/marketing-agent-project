import { existsSync } from 'node:fs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import { BrowserWorkerController } from '../src/controller.ts'

const executable = process.env.BROWSER_TEST_EXECUTABLE ?? '/usr/bin/google-chrome'
describe.skipIf(!existsSync(executable))('real browser worker with an offline publishing fixture', () => {
  let browser: Browser, context: BrowserContext, controller: BrowserWorkerController, dir: string
  const scope = {
    jobId: 'job-one',
    kind: 'publish',
    entryUrl: 'https://social.example/new',
    allowedHosts: ['social.example'],
  }
  const input = vi.fn(async () => {})
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] })
  })
  afterAll(async () => {
    await browser.close()
  })
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'browser-worker-fixture-'))
    context = await browser.newContext()
    // Every page is fulfilled offline. No account or external website is contacted.
    await context.route('https://**/*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><title>Social fixture</title></head><body><h1>Example account</h1><label>Post content<textarea aria-label="Post content"></textarea></label><input type="file" aria-label="Media"><button onclick="location.href='/posts/123'">Publish</button><a href="/logout">Log out</a><a href="https://outside.example/path">Outside</a><p>Content library fixture text</p></body></html>`,
      }),
    )
    controller = new BrowserWorkerController(context, { screen: async () => Buffer.from('png'), input })
    await controller.init()
    await controller.setMode('agent')
  })
  afterEach(async () => {
    await context.close()
    await rm(dir, { force: true, recursive: true })
    input.mockClear()
  })
  const action = (operation: string, extras: Record<string, unknown> = {}) => ({
    ...scope,
    operation,
    ...extras,
  })
  it('observes roles, fills content, uploads the original filename and verifies a published URL', async () => {
    const start = await controller.agent(action('start'))
    expect(start.snapshot).toContain('Post content')
    await controller.agent(
      action('fill', {
        locator: { role: 'textbox', name: 'Post content' },
        text: 'Content library fixture text',
      }),
    )
    const file = join(dir, 'sample.png')
    await writeFile(file, Buffer.from('fixture'))
    await controller.registerUpload('asset-one', { path: file, name: 'sample.png', mimeType: 'image/png' })
    await controller.agent(action('upload', { assetIds: ['asset-one'] }))
    expect(
      await context
        .pages()[0]!
        .locator('input[type=file]')
        .evaluate((el: HTMLInputElement) => el.files?.[0]?.name),
    ).toBe('sample.png')
    await controller.agent(action('click', { locator: { role: 'button', name: 'Publish' } }))
    const result = await controller.agent(
      action('finish', {
        resultUrl: 'https://social.example/posts/123',
        expectedText: 'Content library fixture text',
      }),
    )
    expect(result.verified).toBe(true)
    expect(existsSync(file)).toBe(false)
  })
  it('blocks auth actions, lookalike hosts and noncontent keyboard controls', async () => {
    await controller.agent(action('start'))
    await expect(
      controller.agent(action('click', { locator: { role: 'link', name: 'Log out' } })),
    ).rejects.toThrow(/người dùng/)
    await expect(
      controller.agent(action('click', { locator: { role: 'link', name: 'Outside' } })),
    ).rejects.toThrow(/ngoài phạm vi/)
    await expect(
      controller.agent(action('navigate', { url: 'https://social.example.evil.test/new' })),
    ).rejects.toThrow()
    await expect(controller.agent(action('key', { key: 'Enter' }))).rejects.toThrow(/ô soạn/)
  })
  it('hands a password screen to human control without returning its contents', async () => {
    await context.newPage()
    await context
      .pages()[0]!
      .setContent('<label>Secret password<input type="password" value="never-see-this"></label>')
    // Replace the fixture route for this entry URL only.
    await context.unroute('https://**/*')
    await context.route('https://social.example/new', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<label>Password<input type="password" value="never-see-this"></label>',
      }),
    )
    const result = await controller.agent(action('start'))
    expect(result.needsHuman).toBe(true)
    expect(JSON.stringify(result)).not.toContain('never-see-this')
    await expect(controller.agent(action('snapshot'))).rejects.toThrow(/chế độ agent/)
  })
  it('fences agent actions during human control and keeps human text out of snapshots', async () => {
    await controller.agent(action('start'))
    await controller.setMode('human')
    await controller.human({ operation: 'text', text: 'human-only-secret' })
    expect(input).toHaveBeenCalledWith({ operation: 'text', text: 'human-only-secret' })
    await expect(controller.agent(action('snapshot'))).rejects.toThrow()
    expect(JSON.stringify(controller.status())).not.toContain('human-only-secret')
  })
  it('enforces read-only jobs and refuses success when the post text cannot be verified', async () => {
    await controller.agent({ ...action('start'), kind: 'read' })
    await expect(
      controller.agent({
        ...action('fill', { text: 'Must not post', locator: { role: 'textbox', name: 'Post content' } }),
        kind: 'read',
      }),
    ).rejects.toThrow(/đọc/)
    await expect(
      controller.agent({
        ...action('click', { locator: { role: 'button', name: 'Publish' } }),
        kind: 'read',
      }),
    ).rejects.toThrow(/chỉ đọc/)
    await controller.setMode('agent')
    await controller.agent(action('start'))
    const result = await controller.agent(
      action('finish', {
        resultUrl: 'https://social.example/posts/123',
        expectedText: 'A post that is not on this page',
      }),
    )
    expect(result.verified).toBe(false)
  })
})

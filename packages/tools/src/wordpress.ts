import { lookup } from 'node:dns/promises'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  conflict,
  forbidden,
  validation,
  parseOrThrow,
  wordpressJobSchema,
  wordpressResourceSchema,
  type WordpressSiteView,
  type WordpressJobView,
  type ToolDefinition,
  type AgentRole,
} from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import { defineTool } from './registry.ts'
import { isBlockedHost } from './http-tools.ts'

export const wordpressHash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const dataSchema = z
  .object({
    title: z.string().max(500).optional(),
    content: z.string().max(500000).optional(),
    excerpt: z.string().max(10000).optional(),
    slug: z.string().max(200).optional(),
    status: z
      .enum(['draft', 'publish', 'pending', 'private', 'future'])
      .optional(),
    date: z.string().datetime().optional(),
    date_gmt: z.string().datetime().optional(),
    featured_media: z.number().int().nonnegative().optional(),
    categories: z.array(z.number().int().positive()).max(100).optional(),
    tags: z.array(z.number().int().positive()).max(100).optional(),
    alt_text: z.string().max(2000).optional(),
    caption: z.string().max(5000).optional(),
    description: z.string().max(10000).optional(),
    name: z.string().max(200).optional(),
    parent: z.number().int().nonnegative().optional(),
    filename: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]+$/)
      .max(150)
      .optional(),
    file_base64: z.string().max(1_000_000).optional(),
    styles: z.record(z.unknown()).optional(),
    settings: z.record(z.unknown()).optional(),
  })
  .strict()
const seoSchema = z
  .object({
    title: z.string().max(500).optional(),
    description: z.string().max(2000).optional(),
    canonical: z.string().url().optional(),
    robots: z
      .array(z.enum(['index', 'noindex', 'follow', 'nofollow']))
      .optional(),
    og_title: z.string().max(500).optional(),
    og_description: z.string().max(2000).optional(),
  })
  .strict()
export type WpRequest = (
  site: WordpressSiteView,
  path: string,
  method?: string,
  data?: unknown,
  signal?: AbortSignal,
) => Promise<unknown>
export type WordpressBrowserAdapter = (
  job: WordpressJobView,
  site: WordpressSiteView,
  operation: string,
  values: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<Record<string, unknown>>

/** Every URL is derived from an administrator's registered site, never model arguments. */
export async function assertWordpressUrl(url: string): Promise<void> {
  const u = new URL(url)
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    isBlockedHost(u.hostname)
  )
    throw validation('WordPress cần HTTPS và địa chỉ public')
  const addresses = await lookup(u.hostname, { all: true })
  if (
    !addresses.length ||
    addresses.some(
      (a) =>
        isBlockedHost(a.address) ||
        a.address.startsWith('::ffff:') ||
        a.address === '::',
    )
  )
    throw forbidden('WordPress trỏ tới mạng riêng')
}
export class WordpressService {
  readonly request: WpRequest
  constructor(
    readonly repos: Repos,
    request?: WpRequest,
    readonly browser?: WordpressBrowserAdapter,
  ) {
    this.request =
      request ??
      (async (site, path, method = 'GET', data, signal) => {
        if (
          !path.startsWith('wp/v2/') &&
          !path.startsWith('marketing-agent/v1/')
        )
          throw forbidden('WordPress endpoint chưa hỗ trợ')
        if (path.includes('..') || path.includes('://'))
          throw forbidden('Endpoint không hợp lệ')
        await assertWordpressUrl(site.url)
        const credentials = repos.wordpress.credentials(site.companyId, site.id)
        const response = await fetch(`${site.url}/wp-json/${path}`, {
          method,
          headers: {
            Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
            'Content-Type': 'application/json',
          },
          body: data === undefined ? undefined : JSON.stringify(data),
          redirect: 'error',
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
            : AbortSignal.timeout(30000),
        })
        const reader = response.body?.getReader()
        let size = 0
        const chunks: Uint8Array[] = []
        if (reader)
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              size += value.length
              if (size > 2_000_000)
                throw validation('Phản hồi WordPress vượt giới hạn')
              chunks.push(value)
            }
          } finally {
            await reader.cancel()
          }
        if (!response.ok) throw new Error(`WordPress HTTP ${response.status}`)
        return JSON.parse(Buffer.concat(chunks).toString() || '{}') as unknown
      })
  }
  async check(
    companyId: string,
    siteId: string,
  ): Promise<Record<string, unknown>> {
    const site = this.repos.wordpress.site(companyId, siteId)
    const identity = (await this.request(
      site,
      'wp/v2/users/me?context=edit',
    )) as Record<string, unknown>
    let bridge: Record<string, unknown> = { available: false }
    try {
      bridge = (await this.request(
        site,
        'marketing-agent/v1/capabilities',
      )) as Record<string, unknown>
      if (bridge.protocol !== 1)
        throw validation('Plugin WordPress không tương thích')
      if (
        typeof bridge.siteUrl !== 'string' ||
        new URL(bridge.siteUrl).origin !== new URL(site.url).origin
      )
        throw validation('Danh tính website không khớp')
    } catch (error) {
      bridge = {
        available: false,
        error: error instanceof Error ? error.message : 'Plugin chưa sẵn sàng',
      }
    }
    let browser: Record<string, unknown> = { configured: false }
    if (site.browserChannelId) {
      const channel = this.repos.socialBrowser.channel(
        companyId,
        site.browserChannelId,
      )
      if (new URL(channel.entryUrl).origin === new URL(site.url).origin)
        browser = {
          configured: true,
          desktopMode: this.repos.socialBrowser.desktop(
            companyId,
            channel.desktopId,
          ).mode,
          sessionVerified: false,
        }
    }
    const capabilities = {
      identity: {
        id: identity.id,
        name: identity.name,
        capabilities: identity.capabilities,
      },
      bridge,
      browser,
    }
    this.repos.wordpress.checked(companyId, siteId, capabilities)
    return capabilities
  }
  async read(
    companyId: string,
    siteId: string,
    resource: string,
    id?: string | number,
    search?: string,
  ): Promise<unknown> {
    const site = this.repos.wordpress.site(companyId, siteId)
    parseOrThrow(wordpressResourceSchema, resource, 'WordPress resource')
    const suffix = id === undefined ? '' : `/${encodeURIComponent(String(id))}`
    return this.request(
      site,
      `wp/v2/${resource}${suffix}?context=edit&per_page=50${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    )
  }
  async execute(job: WordpressJobView, signal?: AbortSignal): Promise<void> {
    const repo = this.repos.wordpress
    repo.manage(job.companyId, job.actorId)
    const site = repo.site(job.companyId, job.siteId)
    repo.credentials(job.companyId, site.id)
    const input = job.input
    let writing = false
    try {
      if (input.action === 'audit') {
        const result = await this.audit(site, input.urls ?? [site.url], signal)
        repo.state(job.companyId, job.id, 'completed', result)
        return
      }
      if (input.action === 'admin') {
        const adapter = z
          .object({
            operation: z.enum([
              'plugin_activate',
              'plugin_deactivate',
              'plugin_update',
              'plugin_install',
              'plugin_delete',
              'theme_activate',
              'theme_update',
              'theme_install',
              'theme_delete',
              'settings',
              'menu',
              'widget',
              'elementor',
              'backup',
              'restore_backup',
              'purge_cache',
            ]),
            target: z.string().max(200).optional(),
            values: z.record(z.unknown()).optional(),
          })
          .strict()
          .parse(input.data)
        if (
          ['elementor', 'backup', 'restore_backup'].includes(adapter.operation)
        ) {
          if (
            !this.browser ||
            !site.browserChannelId ||
            adapter.operation === 'restore_backup'
          ) {
            repo.state(job.companyId, job.id, 'waiting_human', {
              browserChannelId: site.browserChannelId,
              operation: adapter.operation,
              message:
                'Cần Browser Worker đã đăng nhập; restore toàn site do owner/admin thực hiện riêng.',
            })
            return
          }
          if (adapter.operation === 'elementor') {
            const postId = z
              .number()
              .int()
              .positive()
              .parse(adapter.values?.postId)
            const before = await this.read(
              job.companyId,
              site.id,
              'pages',
              postId,
            )
            repo.snapshot(job.companyId, job.id, {
              before,
              requested: adapter,
            })
            const backup = (await this.request(
              site,
              'marketing-agent/v1/backup-status',
            )) as { verified?: boolean; timestamp?: number }
            if (
              !backup.verified ||
              !backup.timestamp ||
              backup.timestamp * 1000 < Date.now() - 1800000
            )
              throw conflict(
                'Cần backup UpdraftPlus được xác minh trước khi chỉnh Elementor',
              )
          }
          writing = true
          const result = await this.browser(
            job,
            site,
            adapter.operation,
            adapter.values ?? {},
            signal,
          )
          if (result.status === 'waiting_human') {
            repo.state(job.companyId, job.id, 'waiting_human', result)
            return
          }
          if (adapter.operation === 'backup') {
            // Starting backup is not success. Poll authoritative local-file evidence.
            for (let attempt = 0; attempt < 60; attempt++) {
              signal?.throwIfAborted()
              const evidence = (await this.request(
                site,
                'marketing-agent/v1/backup-status',
              )) as Record<string, unknown>
              if (
                evidence.verified === true &&
                Number(evidence.timestamp) * 1000 >=
                  Date.parse(job.createdAt) - 1000
              ) {
                repo.db.run(
                  'INSERT INTO wordpress_backups(id,company_id,site_id,job_id,status,evidence_json,created_at) VALUES(?,?,?,?,?,?,?)',
                  [
                    wordpressHash(job.id),
                    job.companyId,
                    site.id,
                    job.id,
                    'verified',
                    JSON.stringify(evidence),
                    new Date().toISOString(),
                  ],
                )
                repo.state(job.companyId, job.id, 'completed', {
                  ...result,
                  evidence,
                })
                return
              }
              await new Promise((resolve) => setTimeout(resolve, 2000))
            }
            repo.state(job.companyId, job.id, 'waiting_human', {
              ...result,
              message:
                'Chưa xác minh được backup đầy đủ; kiểm tra UpdraftPlus.',
            })
            return
          }
          repo.state(job.companyId, job.id, 'completed', result)
          return
        }
        const before = await this.request(
          site,
          'marketing-agent/v1/admin-state',
          'POST',
          adapter,
          signal,
        )
        const hash = wordpressHash(before)
        if (
          this.needsDeleteApproval(
            site,
            adapter.operation.endsWith('_delete'),
            job,
            before,
            hash,
          )
        )
          return
        const backup = (await this.request(
          site,
          'marketing-agent/v1/backup-status',
        )) as Record<string, unknown>
        if (
          adapter.operation !== 'purge_cache' &&
          (backup.verified !== true ||
            typeof backup.timestamp !== 'number' ||
            backup.timestamp * 1000 < Date.now() - 30 * 60_000)
        )
          throw conflict(
            'Cần backup UpdraftPlus database và files được xác minh trong 30 phút gần nhất',
          )
        const backupId = createHash('sha256')
          .update(`${job.id}:backup`)
          .digest('hex')
        repo.db.run(
          'INSERT OR IGNORE INTO wordpress_backups(id,company_id,site_id,job_id,status,evidence_json,created_at) VALUES(?,?,?,?,?,?,?)',
          [
            backupId,
            job.companyId,
            site.id,
            job.id,
            'verified',
            JSON.stringify(backup),
            new Date().toISOString(),
          ],
        )
        repo.snapshot(
          job.companyId,
          job.id,
          { before, requested: adapter },
          hash,
        )
        writing = true
        const result = await this.request(
          site,
          'marketing-agent/v1/admin',
          'POST',
          { ...adapter, expected: before },
          signal,
        )
        repo.state(job.companyId, job.id, 'completed', result)
        return
      }
      if (input.action === 'restore') {
        if (!input.sourceJobId) throw validation('Cần sourceJobId để khôi phục')
        const source = repo.job(job.companyId, input.sourceJobId)
        if (source.siteId !== site.id || !source.snapshot)
          throw forbidden('Snapshot không thuộc website')
        const snapshot = source.snapshot as {
          before?: Record<string, unknown>
          after?: unknown
        }
        if (
          !snapshot.before ||
          !source.input.resourceId ||
          !['update', 'seo', 'trash', 'optimize'].includes(source.action)
        )
          throw validation('Snapshot này không hỗ trợ khôi phục nội dung')
        const current = (await this.read(
          job.companyId,
          site.id,
          source.input.resource,
          source.input.resourceId,
        )) as Record<string, unknown>
        if (source.action === 'seo')
          current._ma_seo = await this.request(
            site,
            'marketing-agent/v1/seo-state',
            'POST',
            { id: source.input.resourceId, seoPlugin: site.seoPlugin },
            signal,
          )
        if (
          snapshot.after &&
          wordpressHash(current) !== wordpressHash(snapshot.after)
        )
          throw conflict(
            'Nội dung đã đổi sau job; cần đối chiếu trước khi khôi phục',
          )
        repo.snapshot(job.companyId, job.id, {
          before: current,
          requested: snapshot.before,
        })
        writing = true
        const result = await this.request(
          site,
          'marketing-agent/v1/restore',
          'POST',
          {
            resource: source.input.resource,
            id: source.input.resourceId,
            before: snapshot.before,
            expected: current,
            seoPlugin: site.seoPlugin,
          },
          signal,
        )
        repo.state(job.companyId, job.id, 'completed', result)
        return
      }
      if (input.action !== 'create' && input.resourceId === undefined)
        throw validation('Cần resourceId')
      const before =
        input.action === 'create'
          ? null
          : await this.read(
              job.companyId,
              site.id,
              input.resource,
              input.resourceId,
            )
      const hash = wordpressHash(before)
      if (
        this.needsDeleteApproval(
          site,
          input.action === 'trash',
          job,
          before,
          hash,
        )
      )
        return
      let data: Record<string, unknown>
      if (input.action === 'seo') data = seoSchema.parse(input.data)
      else if (input.action === 'trash') data = {}
      else if (input.action === 'optimize') {
        if (input.resource !== 'media')
          throw validation(
            'Tối ưu tự động chỉ hỗ trợ alt text media do tác vụ tạo',
          )
        const source = input.sourceJobId
          ? repo.job(job.companyId, input.sourceJobId)
          : null
        if (
          !source ||
          source.siteId !== site.id ||
          source.action !== 'create' ||
          source.input.resource !== 'media' ||
          (source.result as { id?: unknown })?.id !== input.resourceId
        )
          throw forbidden('Chỉ tối ưu media do tác vụ quản lý')
        data = z
          .object({
            alt_text: z.string().min(1).max(2000).optional(),
            max_width: z.number().int().min(320).max(2560).optional(),
            quality: z.number().int().min(60).max(90).optional(),
          })
          .strict()
          .parse(input.data)
      } else data = dataSchema.parse(input.data)
      const beforeMeasurement =
        input.action === 'optimize' && input.urls?.length
          ? await this.audit(site, input.urls, signal)
          : undefined
      const beforeCapture = await this.capture(job, site, 'before', signal)
      const snapshotData = { ...data }
      if (snapshotData.file_base64)
        snapshotData.file_base64 = '[uploaded image omitted]'
      repo.snapshot(
        job.companyId,
        job.id,
        { before, requested: snapshotData },
        hash,
      )
      const expectedSeo =
        input.action === 'seo'
          ? await this.request(
              site,
              'marketing-agent/v1/seo-state',
              'POST',
              { id: input.resourceId, seoPlugin: site.seoPlugin },
              signal,
            )
          : undefined
      const snapshotBefore = expectedSeo
        ? { ...(before as Record<string, unknown>), _ma_seo: expectedSeo }
        : before
      repo.snapshot(
        job.companyId,
        job.id,
        {
          before: snapshotBefore,
          requested: snapshotData,
          beforeCapture,
          beforeMeasurement,
        },
        hash,
      )
      writing = true
      const result = await this.request(
        site,
        'marketing-agent/v1/content',
        'POST',
        {
          action: input.action,
          resource: input.resource,
          id: input.resourceId,
          data,
          expected: before,
          expectedSeo,
          seoPlugin: site.seoPlugin,
        },
        signal,
      )
      repo.snapshot(
        job.companyId,
        job.id,
        {
          before: snapshotBefore,
          requested: snapshotData,
          after: result,
          beforeCapture,
          beforeMeasurement,
        },
        hash,
      )
      // The mutation has been acknowledged. Verification failure must never resend it.
      const verification: Record<string, unknown> = {}
      try {
        const resource = result as Record<string, unknown>
        const current = await this.read(
          job.companyId,
          site.id,
          input.resource,
          (resource.id as string | number) ?? input.resourceId,
        )
        if (input.action === 'seo')
          (current as Record<string, unknown>)._ma_seo = await this.request(
            site,
            'marketing-agent/v1/seo-state',
            'POST',
            { id: resource.id ?? input.resourceId, seoPlugin: site.seoPlugin },
            signal,
          )
        verification.readBackMatches =
          wordpressHash(current) === wordpressHash(result)
        verification.restStatus = 200
      } catch {
        verification.readBackMatches = false
        verification.message =
          'Lệnh ghi đã được xác nhận; chưa kiểm chứng được bằng lần đọc riêng.'
      }
      const afterCapture = await this.capture(job, site, 'after', signal)
      verification.beforeCapture = beforeCapture
      verification.afterCapture = afterCapture
      if (beforeMeasurement) {
        verification.beforeMeasurement = beforeMeasurement
        try {
          verification.afterMeasurement = await this.audit(
            site,
            input.urls!,
            signal,
          )
        } catch {
          verification.measurementError =
            'Thay đổi đã ghi; đo lại chưa hoàn tất, không tự lặp lệnh ghi.'
        }
      }
      repo.state(job.companyId, job.id, 'completed', {
        ...(result as Record<string, unknown>),
        _ma_verification: verification,
      })
    } catch (error) {
      repo.state(
        job.companyId,
        job.id,
        writing ? 'uncertain' : 'failed',
        undefined,
        error instanceof Error ? error.message : 'WordPress thất bại',
      )
    } finally {
      repo.event(job.companyId, site.id, job.id, 'execution', {
        status: repo.job(job.companyId, job.id).status,
      })
      this.repos.accounting.audit({
        companyId: job.companyId,
        userId: job.actorId,
        action: 'wordpress.execution',
        target: job.id,
        payload: { status: repo.job(job.companyId, job.id).status },
      })
    }
  }
  private async capture(
    job: WordpressJobView,
    site: WordpressSiteView,
    stage: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (!this.browser || !site.browserChannelId)
      return {
        available: false,
        reason: 'Chưa liên kết Browser Worker để chụp trang',
      }
    try {
      const result = await this.browser(job, site, 'capture', { stage }, signal)
      return result.status === 'verified'
        ? { available: true, image: result.after }
        : {
            available: false,
            reason: 'Browser cần người dùng kiểm tra phiên đăng nhập',
          }
    } catch {
      return {
        available: false,
        reason: 'Chưa chụp được trang; kiểm tra Browser Worker',
      }
    }
  }
  private needsDeleteApproval(
    site: WordpressSiteView,
    deleting: boolean,
    job: WordpressJobView,
    before: unknown,
    hash: string,
  ): boolean {
    const repo = this.repos.wordpress
    if (!deleting || site.environment !== 'production') return false
    if (job.approvedBy && job.approvalHash === hash) {
      repo.manage(job.companyId, job.approvedBy)
      return false
    }
    repo.snapshot(job.companyId, job.id, { before }, hash)
    repo.state(
      job.companyId,
      job.id,
      'awaiting_approval',
      undefined,
      'Cần owner/admin duyệt đúng phiên bản tài nguyên',
    )
    return true
  }
  async audit(
    site: WordpressSiteView,
    urls: string[],
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!urls.length || urls.length > 5) throw validation('Audit cần 1–5 URL')
    const results: unknown[] = []
    const { default: lighthouse } = await import('lighthouse')
    const chrome = await import('chrome-launcher')
    for (const url of urls) {
      if (new URL(url).origin !== new URL(site.url).origin)
        throw forbidden('Audit chỉ URL cùng website')
      await assertWordpressUrl(url)
      for (const formFactor of ['mobile', 'desktop'] as const) {
        signal?.throwIfAborted()
        const browser = await chrome.launch({
          chromeFlags: ['--headless', '--disable-dev-shm-usage'],
          chromePath: process.env.WORDPRESS_CHROME_PATH,
        })
        const stop = () => {
          void browser.kill()
        }
        signal?.addEventListener('abort', stop, { once: true })
        const deadline = setTimeout(stop, 120000)
        try {
          const report = await lighthouse(url, {
            port: browser.port,
            output: 'json',
            onlyCategories: ['performance', 'seo', 'accessibility'],
            formFactor,
            screenEmulation:
              formFactor === 'desktop'
                ? {
                    mobile: false,
                    width: 1350,
                    height: 940,
                    deviceScaleFactor: 1,
                    disabled: false,
                  }
                : undefined,
          })
          if (!report) throw new Error('Không nhận được Lighthouse report')
          const lhr = report.lhr
          signal?.throwIfAborted()
          if (lhr.runtimeError)
            throw new Error(`Lighthouse: ${lhr.runtimeError.code}`)
          if (
            !lhr.finalDisplayedUrl ||
            new URL(lhr.finalDisplayedUrl).origin !== new URL(site.url).origin
          )
            throw forbidden('Trang đo đã chuyển sang website khác')
          results.push({
            url,
            formFactor,
            finalUrl: lhr.finalDisplayedUrl,
            lcp: lhr.audits['largest-contentful-paint']?.numericValue,
            cls: lhr.audits['cumulative-layout-shift']?.numericValue,
            tbt: lhr.audits['total-blocking-time']?.numericValue,
            categories: lhr.categories,
            findings: Object.values(lhr.audits)
              .filter((a) => a.score !== null && a.score < 0.9)
              .map((a) => ({
                id: a.id,
                title: a.title,
                description: a.description,
                displayValue: a.displayValue,
              })),
            screenshot: lhr.audits['final-screenshot']?.details,
          })
        } finally {
          clearTimeout(deadline)
          signal?.removeEventListener('abort', stop)
          await browser.kill()
        }
      }
    }
    return {
      measuredAt: new Date().toISOString(),
      source: 'Lighthouse lab',
      results,
    }
  }
}

export function createWordpressTools(repos: Repos): ToolDefinition[] {
  const service = new WordpressService(repos)
  const roles: readonly AgentRole[] = [
    'marketing-leader',
    'content-writer',
    'seo-technical',
    'web-technical',
    'design-video',
  ]
  const tools: ToolDefinition[] = [
    defineTool({
      name: 'wordpress_sites',
      roles,
      description:
        'Danh sách website WordPress và capability đã xác minh; không trả credential.',
      parameters: { type: 'object', properties: {} },
      handler: async (_args, ctx) => {
        repos.wordpress.manage(ctx.companyId, ctx.actorUserId)
        return {
          content: JSON.stringify(repos.wordpress.sites(ctx.companyId)),
        }
      },
    }),
    defineTool({
      name: 'wordpress_read',
      roles,
      description:
        'Đọc nội dung WordPress; resource=jobs để theo dõi kết quả tác vụ của đúng siteId.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          resource: { type: 'string' },
          resourceId: { type: 'string' },
          search: { type: 'string' },
        },
        required: ['siteId', 'resource'],
      },
      handler: async (args, ctx) => {
        repos.wordpress.manage(ctx.companyId, ctx.actorUserId)
        const value = z
          .object({
            siteId: z.string(),
            resource: z.union([wordpressResourceSchema, z.literal('jobs')]),
            resourceId: z.union([z.string(), z.number()]).optional(),
            search: z.string().max(200).optional(),
          })
          .parse(args)
        if (value.resource === 'jobs') {
          repos.wordpress.site(ctx.companyId, value.siteId)
          const jobs = value.resourceId
            ? [repos.wordpress.job(ctx.companyId, String(value.resourceId))]
            : repos.wordpress.jobs(ctx.companyId)
          return {
            content: JSON.stringify(
              jobs.filter((j) => j.siteId === value.siteId),
            ),
          }
        }
        return {
          content: JSON.stringify(
            await service.read(
              ctx.companyId,
              value.siteId,
              value.resource,
              value.resourceId,
              value.search,
            ),
          ),
        }
      },
    }),
  ]
  for (const [name, action, allowed] of [
    [
      'wordpress_content',
      null,
      ['marketing-leader', 'content-writer', 'seo-technical', 'web-technical', 'design-video'],
    ],
    ['wordpress_seo', 'seo', ['marketing-leader', 'seo-technical', 'web-technical']],
    [
      'wordpress_admin',
      'admin',
      ['marketing-leader', 'web-technical', 'design-video', 'seo-technical'],
    ],
    ['wordpress_audit', 'audit', ['marketing-leader', 'seo-technical', 'web-technical']],
    ['wordpress_optimize', 'optimize', ['marketing-leader', 'seo-technical', 'web-technical']],
    ['wordpress_restore', 'restore', ['marketing-leader', 'web-technical']],
  ] as const)
    tools.push(
      defineTool({
        name,
        roles: allowed,
        description:
          'Tạo WordPress job bền vững. Trả job ID để theo dõi; không báo đã thực hiện khi job còn queued/waiting. Xóa production cần duyệt riêng. Không gửi credential trong data.',
        parameters: {
          type: 'object',
          properties: {
            siteId: { type: 'string' },
            action: { type: 'string' },
            resource: { type: 'string' },
            resourceId: { type: 'integer' },
            data: { type: 'object', additionalProperties: true },
            urls: { type: 'array', items: { type: 'string' } },
            sourceJobId: { type: 'string' },
            idempotencyKey: { type: 'string' },
          },
          required: ['siteId', 'idempotencyKey'],
        },
        handler: async (args, ctx) => {
          const input = parseOrThrow(
            wordpressJobSchema,
            { ...args, ...(action ? { action } : {}) },
            'WordPress job',
          )
          if (!action && !['create', 'update', 'trash'].includes(input.action))
            throw forbidden('wordpress_content chỉ tạo/sửa/xóa nội dung')
          const job = repos.wordpress.enqueue(
            ctx.companyId,
            ctx.actorUserId!,
            input,
          )
          return { content: JSON.stringify(job), data: job }
        },
      }),
    )
  return tools
}

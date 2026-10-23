import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import {
  browserChannelSchema,
  browserContentSchema,
  browserDesktopSchema,
  browserDesktopUpdateSchema,
  browserHumanInputSchema,
  browserJobSchema,
  browserModeSchema,
  conflict,
  forbidden,
  newId,
  parseOrThrow,
  type BrowserOverview,
} from '@marketing-agent/shared'
import { SocialBrowserService, assertBrowserWorkerEndpoint, browserAssetPath } from '@marketing-agent/tools'
import type { AppContext } from '../context.ts'
import type { Middleware, Router } from '../http/router.ts'
import { readAuth, requireManage, requireMembership, requireTenancyState } from '../http/middleware.ts'
import { receiveBrowserAsset } from '../services/browser-assets.ts'
import { enableBrowserToolGrants, startBrowserJob } from '../services/browser-job-runner.ts'

export function registerSocialBrowserRoutes(router: Router, ctx: AppContext): void {
  const repo = ctx.repos.socialBrowser,
    service = new SocialBrowserService(ctx.repos, ctx.config.companiesRoot)
  const base = '/api/companies/:companyId/social-browser'
  const origin: Middleware = (r, next) => {
    if (r.req.headers.origin) {
      let host: string
      try {
        host = new URL(r.req.headers.origin).host
      } catch {
        throw forbidden('Origin không hợp lệ')
      }
      if (host !== r.req.headers.host) throw forbidden('Origin không hợp lệ')
    }
    return next()
  }
  const read = [requireMembership(ctx.repos)],
    manage = [...read, requireManage, origin]
  router.get(
    base,
    (r) => {
      const companyId = r.params.companyId!,
        role = requireTenancyState(r).role
      const overview: BrowserOverview = {
        desktops: repo.desktops(companyId),
        channels: repo.channels(companyId),
        contents: repo.contents(companyId),
        jobs: repo.jobs(companyId),
        canManage: role === 'owner' || role === 'admin',
      }
      r.res.setHeader('Cache-Control', 'no-store')
      r.json(200, overview)
    },
    read,
  )
  router.post(
    `${base}/desktops`,
    async (r) => {
      const companyId = r.params.companyId!,
        input = parseOrThrow(browserDesktopSchema, await r.body(), 'môi trường trình duyệt')
      assertBrowserWorkerEndpoint(input.endpoint)
      const desktop = repo.createDesktop(companyId, input)
      enableBrowserToolGrants(ctx, companyId)
      ctx.repos.accounting.audit({
        companyId,
        userId: readAuth(r)!.user.id,
        action: 'browser.desktop.create',
        target: desktop.id,
      })
      r.json(201, { desktop })
    },
    manage,
  )
  router.post(
    `${base}/desktops/:desktopId/test`,
    async (r) => {
      r.json(200, await service.health(r.params.companyId!, r.params.desktopId!))
    },
    manage,
  )
  router.patch(
    `${base}/desktops/:desktopId`,
    async (r) => {
      const companyId = r.params.companyId!,
        id = r.params.desktopId!
      repo.desktop(companyId, id)
      const input = parseOrThrow(browserDesktopUpdateSchema, await r.body(), 'kết nối môi trường')
      assertBrowserWorkerEndpoint(input.endpoint)
      const desktop = repo.updateDesktop(companyId, id, input)
      ctx.repos.accounting.audit({
        companyId,
        userId: readAuth(r)!.user.id,
        action: 'browser.desktop.update',
        target: id,
      })
      r.json(200, { desktop })
    },
    manage,
  )
  router.post(
    `${base}/desktops/:desktopId/mode`,
    async (r) => {
      const { mode } = parseOrThrow(browserModeSchema, await r.body(), 'chế độ điều khiển')
      const desktop = await service.mode(r.params.companyId!, r.params.desktopId!, mode)
      ctx.repos.accounting.audit({
        companyId: r.params.companyId!,
        userId: readAuth(r)!.user.id,
        action: 'browser.desktop.mode',
        target: desktop.id,
        payload: { mode },
      })
      r.json(200, { desktop })
    },
    manage,
  )
  router.get(
    `${base}/desktops/:desktopId/screen`,
    async (r) => {
      const bytes = await service.screen(r.params.companyId!, r.params.desktopId!)
      r.res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Resource-Policy': 'same-origin',
      })
      r.res.end(bytes)
    },
    manage,
  )
  router.post(
    `${base}/desktops/:desktopId/input`,
    async (r) => {
      const input = parseOrThrow(browserHumanInputSchema, await r.body(), 'thao tác thủ công')
      await service.humanInput(r.params.companyId!, r.params.desktopId!, input)
      r.json(200, { ok: true })
    },
    manage,
  )
  router.post(
    `${base}/channels`,
    async (r) => {
      const channel = repo.saveChannel(
        r.params.companyId!,
        parseOrThrow(browserChannelSchema, await r.body(), 'kênh'),
      )
      r.json(201, { channel })
    },
    manage,
  )
  router.patch(
    `${base}/channels/:channelId`,
    async (r) => {
      repo.channel(r.params.companyId!, r.params.channelId!)
      const channel = repo.saveChannel(
        r.params.companyId!,
        parseOrThrow(browserChannelSchema, await r.body(), 'kênh'),
        r.params.channelId!,
      )
      r.json(200, { channel })
    },
    manage,
  )
  router.post(
    `${base}/contents`,
    async (r) => {
      r.json(201, {
        content: repo.saveContent(
          r.params.companyId!,
          parseOrThrow(browserContentSchema, await r.body(), 'nội dung'),
        ),
      })
    },
    manage,
  )
  router.patch(
    `${base}/contents/:contentId`,
    async (r) => {
      repo.content(r.params.companyId!, r.params.contentId!)
      r.json(200, {
        content: repo.saveContent(
          r.params.companyId!,
          parseOrThrow(browserContentSchema, await r.body(), 'nội dung'),
          r.params.contentId!,
        ),
      })
    },
    manage,
  )
  router.post(
    `${base}/contents/:contentId/assets`,
    async (r) => {
      const companyId = r.params.companyId!,
        contentId = r.params.contentId!
      repo.content(companyId, contentId)
      repo.assertEditable(companyId, contentId)
      if (repo.assets(companyId, contentId).length >= 20) throw conflict('Mỗi nội dung tối đa 20 tệp')
      const id = newId(),
        target = browserAssetPath(ctx.config.companiesRoot, companyId, id)
      try {
        const input = await receiveBrowserAsset(r.req, target)
        r.json(201, { asset: repo.addAsset(companyId, contentId, { id, ...input }) })
      } catch (error) {
        await rm(target, { force: true })
        throw error
      }
    },
    manage,
  )
  router.get(
    `${base}/assets/:assetId`,
    async (r) => {
      const asset = repo.asset(r.params.companyId!, r.params.assetId!)
      r.res.writeHead(200, {
        'Content-Type': asset.mimeType,
        'Content-Length': asset.sizeBytes,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      const stream = createReadStream(browserAssetPath(ctx.config.companiesRoot, asset.companyId, asset.id))
      stream.on('error', () => r.res.destroy())
      stream.pipe(r.res)
    },
    read,
  )
  router.delete(
    `${base}/assets/:assetId`,
    async (r) => {
      const asset = repo.asset(r.params.companyId!, r.params.assetId!)
      repo.removeAsset(asset.companyId, asset.id)
      await rm(browserAssetPath(ctx.config.companiesRoot, asset.companyId, asset.id), { force: true })
      r.json(200, { deleted: true })
    },
    manage,
  )
  router.post(
    `${base}/jobs`,
    async (r) => {
      const job = repo.createJob(
        r.params.companyId!,
        readAuth(r)!.user.id,
        parseOrThrow(browserJobSchema, await r.body(), 'tác vụ'),
      )
      r.json(201, { job })
    },
    manage,
  )
  router.get(
    `${base}/jobs`,
    (r) => {
      r.json(200, { jobs: repo.jobs(r.params.companyId!) })
    },
    read,
  )
  router.get(
    `${base}/jobs/:jobId`,
    (r) => {
      const companyId = r.params.companyId!,
        id = r.params.jobId!
      r.json(200, { job: repo.job(companyId, id), events: repo.events(companyId, id) })
    },
    read,
  )
  router.post(
    `${base}/jobs/:jobId/run`,
    (r) => {
      r.json(202, { job: startBrowserJob(ctx, r.params.companyId!, readAuth(r)!.user.id, r.params.jobId!) })
    },
    manage,
  )
  router.post(
    `${base}/jobs/:jobId/cancel`,
    async (r) => {
      await service.cancel(r.params.companyId!, r.params.jobId!)
      r.json(200, { job: repo.job(r.params.companyId!, r.params.jobId!) })
    },
    manage,
  )
}

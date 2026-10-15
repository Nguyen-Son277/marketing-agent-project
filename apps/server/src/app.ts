/**
 * HTTP application assembly.
 *
 * Order matters and is fixed here: session resolution runs for every request,
 * each route declares its own tenancy/role middleware, and one error boundary
 * converts thrown `AppError`s into stable JSON without leaking internals in
 * production.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { AppError, isAppError, toAppError } from '@marketing-agent/shared'
import { resolveLocale, translator } from '@marketing-agent/i18n'
import type { Repos } from '@marketing-agent/db'
import type { AppContext } from './context.ts'
import { createRequestContext, Router, runChain, type Handler, type HttpMethod, type Middleware } from './http/router.ts'
import { accountAccessMiddleware, sessionMiddleware } from './http/middleware.ts'
import { registerDailyReportRoutes } from './routes/daily-report-routes.ts'
import { registerAdminRoutes } from './routes/admin-routes.ts'
import { registerWorkforceRoutes } from './routes/workforce-routes.ts'
import { registerAuthRoutes, registerMemberRoutes } from './routes/auth-routes.ts'

/** Optional route modules, resolved lazily so a partially built package cannot block boot. */
export interface OptionalRouteModule {
  readonly name: string
  readonly register: (router: Router, ctx: AppContext) => void
}

export interface BuildAppOptions {
  readonly context: AppContext
  readonly optionalModules?: readonly OptionalRouteModule[]
}

export interface App {
  readonly router: Router
  readonly context: AppContext
  readonly middleware: readonly Middleware[]
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>
}

export function buildApp(options: BuildAppOptions): App {
  const { context } = options
  const repos: Repos = context.repos
  const router = new Router()

  registerAuthRoutes(router, repos, context.config.sessionTtlDays)
  registerMemberRoutes(router, repos)
  registerAdminRoutes(router, repos)
  registerWorkforceRoutes(router, repos)
  registerDailyReportRoutes(router, context)

  for (const module of options.optionalModules ?? []) {
    try {
      module.register(router, context)
    } catch (error) {
      // A missing optional route module (a package still under construction)
      // degrades to a warning instead of preventing the server from starting.
      console.warn(`[routes] bỏ qua module "${module.name}": ${String(error)}`)
    }
  }

  router.get('/healthz', (ctx) => {
    ctx.json(200, { status: 'ok' })
  })

  router.get('/readyz', (ctx) => {
    // Sẵn sàng = catalog (định nghĩa agent + kỹ năng) đã cài. KHÔNG đòi model: từ khi
    // nhà cung cấp/model do từng công ty khai trong Cài đặt, một hệ thống mới hợp lệ
    // vẫn chưa có model nào.
    const agentDefs = repos.team.listAgentDefs().length
    const skills = repos.team.listSkills().length
    const models = repos.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM llm_models WHERE enabled = 1')?.n ?? 0
    const ready = agentDefs > 0 && skills > 0
    ctx.json(ready ? 200 : 503, {
      status: ready ? 'ready' : 'not-ready',
      agentDefs,
      skills,
      models,
      sseClients: context.events.subscriberCount(),
    })
  })

  // The SPA fallback answers anything not under /api.
  const webDist = context.config.webDist
  const staticHandler: Handler | undefined = webDist ? createStaticHandler(webDist) : undefined

  const middleware: readonly Middleware[] = [sessionMiddleware(repos), accountAccessMiddleware]

  return {
    router,
    context,
    middleware,
    async handle(req, res) {
      const method = (req.method ?? 'GET').toUpperCase() as HttpMethod
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      const matched = router.match(method, url.pathname)

      try {
        if (matched) {
          const ctx = createRequestContext(req, res, matched.params, {
            maxBodyBytes: context.config.maxBodyBytes,
            secureCookies: context.config.isProduction,
          })
          await runChain([...middleware, ...matched.route.middleware], ctx, matched.route.handler)
          return
        }

        // Known path, wrong method: answer 405 with an Allow header.
        if (url.pathname.startsWith('/api/')) {
          const locale = resolveLocale({ acceptLanguage: req.headers['accept-language'] })
          const t = translator(locale)
          const allowed = router.allowedMethods(url.pathname)
          if (allowed.length > 0) {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', Allow: allowed.join(', ') })
            res.end(
              JSON.stringify({
                error: {
                  code: 'method_not_allowed',
                  message: t('errors.generic.methodNotAllowed'),
                  messageKey: 'errors.generic.methodNotAllowed',
                  allowed,
                },
              }),
            )
            return
          }
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(
            JSON.stringify({
              error: {
                code: 'not_found',
                message: t('errors.generic.endpointNotFound'),
                messageKey: 'errors.generic.endpointNotFound',
              },
            }),
          )
          return
        }

        if (staticHandler && method === 'GET') {
          const ctx = createRequestContext(req, res, {}, {
            maxBodyBytes: context.config.maxBodyBytes,
            secureCookies: context.config.isProduction,
          })
          await staticHandler(ctx)
          return
        }

        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Không tìm thấy')
      } catch (error) {
        sendError(res, error, context.config.isProduction, url.pathname, req.headers['accept-language'])
      }
    },
  }
}

/**
 * Phong bì JSON lỗi duy nhất cho mọi kiểu hỏng.
 *
 * Vì sao dịch ở ĐÂY mà không dịch ở nơi ném lỗi: lỗi được ném từ những tầng không biết
 * gì về yêu cầu HTTP (`db`, `kb`, `llm`), nên chúng không thể biết ngôn ngữ của người
 * dùng. Đây là điểm duy nhất vừa biết ngôn ngữ của yêu cầu vừa biết nội dung lỗi.
 *
 * `messageKey` và `messageParams` được trả kèm để trình duyệt dịch lại theo ngôn ngữ
 * giao diện đang chọn — cần thiết vì người dùng có thể đổi ngôn ngữ sau khi đã tải
 * trang, còn `Accept-Language` chỉ được gửi lúc gọi API.
 */
export function sendError(
  res: ServerResponse,
  error: unknown,
  isProduction: boolean,
  path: string,
  acceptLanguage?: string | undefined,
): void {
  if (res.headersSent) {
    // Headers are out (typically a stream): the only correct move is to close.
    res.end()
    return
  }
  const appError = toAppError(error)
  if (appError.status >= 500) {
    const safePath = path.startsWith('/api/public/daily-reports/') ? '/api/public/daily-reports/[redacted]' : path
    console.error(`[error] ${safePath}:`, error)
  }
  const exposeDetails = !isProduction && appError.status < 500

  // Chỉ dịch khi lỗi CÓ khoá và khoá đó tồn tại trong catalog. Khoá lạ (ví dụ gõ sai)
  // không được làm hỏng phản hồi: khi đó giữ nguyên câu mặc định.
  let message = appError.message
  if (appError.messageKey) {
    const t = translator(resolveLocale({ acceptLanguage }))
    const translated = t(appError.messageKey as never, appError.messageParams)
    // i18next trả về chính khoá khi thiếu bản dịch; nhận ra điều đó để không trả khoá
    // thô cho người dùng.
    if (translated && translated !== appError.messageKey) message = translated
  }

  res.writeHead(appError.status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(
    JSON.stringify({
      error: {
        code: appError.code,
        message,
        ...(appError.messageKey ? { messageKey: appError.messageKey } : {}),
        ...(appError.messageParams ? { messageParams: appError.messageParams } : {}),
        ...(exposeDetails && appError.details !== undefined ? { details: appError.details } : {}),
      },
    }),
  )
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

/**
 * Serve the built SPA. Unknown non-asset paths fall back to index.html so
 * client-side routes deep-link correctly; assets 404 instead of returning HTML,
 * which would otherwise be parsed as a broken script.
 */
function createStaticHandler(root: string): Handler {
  const rootResolved = resolve(root)
  return async (ctx) => {
    const requested = ctx.url.pathname === '/' ? '/index.html' : ctx.url.pathname
    const candidate = safeJoin(rootResolved, requested)
    if (candidate && existsSync(candidate) && statSync(candidate).isFile()) {
      return streamFile(ctx.res, candidate)
    }
    // Has a file extension -> a missing asset, not a route.
    if (extname(requested) !== '') {
      ctx.text(404, 'Không tìm thấy tài nguyên')
      return
    }
    const index = join(rootResolved, 'index.html')
    if (!existsSync(index)) {
      ctx.text(404, 'Chưa có bản dựng giao diện. Chạy: pnpm build:web')
      return
    }
    return streamFile(ctx.res, index)
  }
}

/** Resolve a URL path under root, refusing traversal outside it. */
function safeJoin(root: string, urlPath: string): string | undefined {
  const decoded = decodeURIComponent(urlPath)
  const normalized = normalize(decoded).replace(/^([/\\])+/, '')
  const target = resolve(root, normalized)
  if (target !== root && !target.startsWith(root + sep)) return undefined
  return target
}

function streamFile(res: ServerResponse, file: string): void {
  const stat = statSync(file)
  const type = MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
  const isHashed = /-[A-Za-z0-9_]{8,}\./.test(file)
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': isHashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
}

/** Re-exported so tests can build a router without a full app. */
export { createRequestContext, Router }

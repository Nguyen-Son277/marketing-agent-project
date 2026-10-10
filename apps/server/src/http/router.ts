/**
 * A small router over `node:http`.
 *
 * Deliberately dependency-free: this deployment must run from a source checkout
 * with no build step, and a web framework would add a bundling requirement for
 * no capability this project needs. It handles path parameters, per-route
 * middleware, JSON parsing with a size cap, cookies, and SSE.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { AppError, validation } from '@marketing-agent/shared'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'OPTIONS'

export interface RequestContext {
  readonly req: IncomingMessage
  readonly res: ServerResponse
  readonly method: HttpMethod
  readonly url: URL
  /** Path segments captured from `:name` placeholders. */
  readonly params: Readonly<Record<string, string>>
  /** Query string accessor with a default. */
  query(name: string): string | undefined
  /** Parse and size-check the JSON body. Returns undefined for an empty body. */
  body<T = unknown>(): Promise<T>
  /** Parsed cookies for this request. */
  cookies(): Readonly<Record<string, string>>
  /** Values attached by middleware (authenticated user, membership, …). */
  state: Record<string, unknown>
  /** Set a cookie on the response. */
  setCookie(name: string, value: string, options?: CookieOptions): void
  clearCookie(name: string): void
  json(status: number, payload: unknown): void
  text(status: number, payload: string, contentType?: string): void
  redirect(location: string, status?: number): void
  /** Begin an SSE stream; returns a writer the caller must end. */
  sse(): SseWriter
}

export interface CookieOptions {
  readonly maxAgeSeconds?: number
  readonly httpOnly?: boolean
  readonly sameSite?: 'Strict' | 'Lax' | 'None'
  readonly secure?: boolean
  readonly path?: string
}

export interface SseWriter {
  readonly closed: boolean
  send(event: string, data: unknown): void
  comment(text: string): void
  end(): void
  onClose(handler: () => void): void
}

export type Handler = (ctx: RequestContext) => Promise<void> | void
export type Middleware = (ctx: RequestContext, next: () => Promise<void>) => Promise<void> | void

interface Route {
  readonly method: HttpMethod
  readonly segments: readonly string[]
  readonly handler: Handler
  readonly middleware: readonly Middleware[]
}

export class HttpError extends AppError {}

export class Router {
  private readonly routes: Route[] = []

  add(method: HttpMethod, path: string, handler: Handler, middleware: readonly Middleware[] = []): void {
    this.routes.push({
      method,
      segments: splitPath(path),
      handler,
      middleware,
    })
  }

  get(path: string, handler: Handler, middleware?: readonly Middleware[]): void {
    this.add('GET', path, handler, middleware)
  }
  post(path: string, handler: Handler, middleware?: readonly Middleware[]): void {
    this.add('POST', path, handler, middleware)
  }
  patch(path: string, handler: Handler, middleware?: readonly Middleware[]): void {
    this.add('PATCH', path, handler, middleware)
  }
  put(path: string, handler: Handler, middleware?: readonly Middleware[]): void {
    this.add('PUT', path, handler, middleware)
  }
  delete(path: string, handler: Handler, middleware?: readonly Middleware[]): void {
    this.add('DELETE', path, handler, middleware)
  }

  /** Match a request, returning the handler and any captured params. */
  match(method: HttpMethod, pathname: string): { route: Route; params: Record<string, string> } | undefined {
    const segments = splitPath(pathname)
    for (const route of this.routes) {
      if (route.method !== method) continue
      const params = matchSegments(route.segments, segments)
      if (params) return { route, params }
    }
    return undefined
  }

  /** Paths that exist under a different method, used for a helpful 405. */
  allowedMethods(pathname: string): HttpMethod[] {
    const segments = splitPath(pathname)
    const allowed = new Set<HttpMethod>()
    for (const route of this.routes) {
      if (matchSegments(route.segments, segments)) allowed.add(route.method)
    }
    return [...allowed]
  }
}

function splitPath(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0)
}

/**
 * Match route segments against request segments. `:name` captures one segment;
 * `*` captures the rest and is only valid as the last segment.
 */
function matchSegments(
  route: readonly string[],
  actual: readonly string[],
): Record<string, string> | undefined {
  const params: Record<string, string> = {}
  for (let i = 0; i < route.length; i++) {
    const pattern = route[i]!
    if (pattern === '*') {
      params['*'] = actual.slice(i).map(decodeURIComponent).join('/')
      return params
    }
    const segment = actual[i]
    if (segment === undefined) return undefined
    if (pattern.startsWith(':')) {
      params[pattern.slice(1)] = decodeURIComponent(segment)
      continue
    }
    if (pattern !== segment) return undefined
  }
  return route.length === actual.length ? params : undefined
}

export interface CreateRequestContextOptions {
  readonly maxBodyBytes: number
  readonly secureCookies: boolean
}

/** Build the per-request context object handed to handlers. */
export function createRequestContext(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  options: CreateRequestContextOptions,
): RequestContext {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  let bodyPromise: Promise<unknown> | undefined
  let cookiesParsed: Record<string, string> | undefined
  const pendingCookies: string[] = []

  const ctx: RequestContext = {
    req,
    res,
    method: (req.method ?? 'GET').toUpperCase() as HttpMethod,
    url,
    params,
    query(name) {
      const value = url.searchParams.get(name)
      return value === null || value === '' ? undefined : value
    },
    async body<T = unknown>(): Promise<T> {
      bodyPromise ??= readJsonBody(req, options.maxBodyBytes)
      return (await bodyPromise) as T
    },
    cookies() {
      cookiesParsed ??= parseCookies(req.headers.cookie)
      return cookiesParsed
    },
    state: {},
    setCookie(name, value, cookieOptions = {}) {
      pendingCookies.push(serializeCookie(name, value, { ...cookieOptions, secure: cookieOptions.secure ?? options.secureCookies }))
    },
    clearCookie(name) {
      pendingCookies.push(serializeCookie(name, '', { maxAgeSeconds: 0, path: '/' }))
    },
    json(status, payload) {
      if (pendingCookies.length > 0) res.setHeader('Set-Cookie', pendingCookies)
      const text = JSON.stringify(payload)
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(text),
        'Cache-Control': 'no-store',
      })
      res.end(text)
    },
    text(status, payload, contentType = 'text/plain; charset=utf-8') {
      if (pendingCookies.length > 0) res.setHeader('Set-Cookie', pendingCookies)
      res.writeHead(status, {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(payload),
      })
      res.end(payload)
    },
    redirect(location, status = 302) {
      if (pendingCookies.length > 0) res.setHeader('Set-Cookie', pendingCookies)
      res.writeHead(status, { Location: location })
      res.end()
    },
    sse() {
      if (pendingCookies.length > 0) res.setHeader('Set-Cookie', pendingCookies)
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      // A short retry keeps a reconnecting browser responsive without hammering.
      res.write('retry: 3000\n\n')
      const closeHandlers: (() => void)[] = []
      let closed = false
      const markClosed = () => {
        if (closed) return
        closed = true
        for (const handler of closeHandlers) handler()
      }
      res.on('close', markClosed)
      return {
        get closed() {
          return closed
        },
        send(event, data) {
          if (closed) return
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        },
        comment(text) {
          if (closed) return
          res.write(`: ${text}\n\n`)
        },
        end() {
          if (closed) return
          closed = true
          res.end()
        },
        onClose(handler) {
          if (closed) handler()
          else closeHandlers.push(handler)
        },
      }
    },
  }
  return ctx
}

/** Read and parse a JSON body, enforcing a byte cap before buffering everything. */
export function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    const declared = Number(req.headers['content-length'] ?? 0)
    if (Number.isFinite(declared) && declared > maxBytes) {
      rejectPromise(validation(`Nội dung yêu cầu vượt giới hạn ${maxBytes} byte`))
      req.resume()
      return
    }
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        rejectPromise(validation(`Nội dung yêu cầu vượt giới hạn ${maxBytes} byte`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', rejectPromise)
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (raw.length === 0) {
        resolvePromise(undefined)
        return
      }
      try {
        resolvePromise(JSON.parse(raw))
      } catch (cause) {
        rejectPromise(validation('Nội dung yêu cầu không phải JSON hợp lệ', { cause: String(cause) }))
      }
    })
  })
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (name.length === 0) continue
    out[name] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${options.path ?? '/'}`)
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAgeSeconds)}`)
  if (options.httpOnly ?? true) parts.push('HttpOnly')
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`)
  if (options.secure) parts.push('Secure')
  return parts.join('; ')
}

/** Run a middleware chain around a handler; the last step calls the handler. */
export async function runChain(
  chain: readonly Middleware[],
  ctx: RequestContext,
  handler: Handler,
): Promise<void> {
  let index = -1
  const dispatch = async (position: number): Promise<void> => {
    if (position <= index) throw new AppError('internal', 'next() được gọi nhiều lần trong middleware')
    index = position
    const middleware = chain[position]
    if (middleware) {
      await middleware(ctx, () => dispatch(position + 1))
      return
    }
    await handler(ctx)
  }
  await dispatch(0)
}

/**
 * A tiny in-process client for server tests.
 *
 * It talks to the real `node:http` server over a loopback socket (an ephemeral
 * port), so cookie handling, status codes and streaming behave exactly as in
 * production without pulling in an HTTP test library.
 */
import { createServer, type Server } from 'node:http'
import type { App } from '../src/app.ts'

export interface TestResponse {
  readonly status: number
  readonly headers: Headers
  readonly body: string
  json<T = unknown>(): T
  cookie(name: string): string | undefined
}

export interface TestClient {
  readonly baseUrl: string
  request(
    method: string,
    path: string,
    options?: { body?: unknown; headers?: Record<string, string> },
  ): Promise<TestResponse>
  close(): Promise<void>
}

export async function startTestServer(app: App): Promise<TestClient> {
  const server: Server = createServer((req, res) => {
    void app.handle(req, res)
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  if (typeof address !== 'object' || !address) throw new Error('Không lấy được cổng test')
  const baseUrl = `http://127.0.0.1:${address.port}`

  return {
    baseUrl,
    async request(method, path, options = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(options.headers ?? {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: 'manual',
      })
      const body = await response.text()
      const setCookie = response.headers.getSetCookie?.() ?? []
      return {
        status: response.status,
        headers: response.headers,
        body,
        json<T = unknown>() {
          return JSON.parse(body) as T
        },
        cookie(name: string) {
          for (const entry of setCookie) {
            const pair = entry.split(';')[0] ?? ''
            const eq = pair.indexOf('=')
            if (eq > 0 && pair.slice(0, eq) === name) {
              return decodeURIComponent(pair.slice(eq + 1))
            }
          }
          return undefined
        },
      }
    },
    async close() {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    },
  }
}

/** Fetch a cookie value from a prior response and format it for a request header. */
export function cookieHeader(response: TestResponse, name: string): Record<string, string> {
  const value = response.cookie(name)
  if (value === undefined) throw new Error(`Phản hồi không có cookie ${name}`)
  return { Cookie: `${name}=${encodeURIComponent(value)}` }
}

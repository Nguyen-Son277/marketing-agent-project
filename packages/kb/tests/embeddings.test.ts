/** Test embedding: bản băm tất định, fallback khi thiếu ONNX, và provider remote. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createEmbeddingProvider,
  HashEmbeddingProvider,
  RemoteEmbeddingProvider,
} from '../src/embeddings.ts'

const dot = (a: Float32Array, b: Float32Array): number => {
  let sum = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) sum += (a[i] ?? 0) * (b[i] ?? 0)
  return sum
}

describe('HashEmbeddingProvider', () => {
  it('tất định: cùng input cho cùng vector', async () => {
    const provider = new HashEmbeddingProvider({ dim: 128 })
    const [first] = await provider.embed(['chính sách giá của chúng tôi'])
    const [second] = await provider.embed(['chính sách giá của chúng tôi'])
    expect(provider.dim).toBe(128)
    expect(first).toBeInstanceOf(Float32Array)
    expect(Array.from(first!)).toEqual(Array.from(second!))
  })

  it('có tín hiệu tương đồng thật: cùng từ thì gần nhau hơn', async () => {
    const provider = new HashEmbeddingProvider({ dim: 256 })
    const [a, b, c] = await provider.embed([
      'chính sách giá của chúng tôi là gì',
      'chính sách giá sản phẩm mới',
      'màu sắc thương hiệu và logo',
    ])
    expect(dot(a!, b!)).toBeGreaterThan(dot(a!, c!))
  })
})

describe('createEmbeddingProvider', () => {
  it('fallback sang hash khi không có ONNX local và ghi log rõ ràng', async () => {
    const logs: string[] = []
    const provider = await createEmbeddingProvider({
      provider: 'local',
      logger: (message) => logs.push(message),
    })
    // Trong repo này @xenova/transformers chưa được cài, nên phải rơi về hash.
    expect(provider.name).toMatch(/^hash-bow-/)
    expect(logs.join('\n')).toMatch(/HashEmbeddingProvider/)
  })

  it('chọn hash khi EMBEDDING_PROVIDER=hash', async () => {
    const provider = await createEmbeddingProvider({ provider: 'hash', dim: 64 })
    expect(provider.name).toBe('hash-bow-64')
    await expect(provider.probe!()).resolves.toBe(true)
  })

  it('fallback sang hash khi remote thiếu base URL', async () => {
    const logs: string[] = []
    const provider = await createEmbeddingProvider({ provider: 'remote', logger: (m) => logs.push(m) })
    expect(provider.name).toMatch(/^hash-bow-/)
    expect(logs.join(' ')).toContain('EMBEDDING_BASE_URL')
  })
})

describe('RemoteEmbeddingProvider', () => {
  let server: Server | null = null

  afterEach(() => {
    server?.close()
    server = null
  })

  it('gọi POST /v1/embeddings và đọc vector theo index', async () => {
    const captured: { url?: string; body?: unknown; authorization?: string } = {}
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        captured.url = req.url
        captured.authorization = req.headers.authorization
        captured.body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const parsed = captured.body as { input: string[] }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            data: parsed.input
              .map((_, index) => ({ index, embedding: Array.from({ length: 8 }, (_, i) => (i === index ? 1 : 0.5)) }))
              .reverse(),
          }),
        )
      })
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as AddressInfo).port
    const provider = new RemoteEmbeddingProvider({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: 'test-embed',
      apiKey: 'secret-key',
      dim: 8,
    })

    const vectors = await provider.embed(['câu một', 'câu hai'])
    expect(vectors).toHaveLength(2)
    expect(vectors[0]!.length).toBe(8)
    expect(captured.url).toBe('/v1/embeddings')
    expect(captured.authorization).toBe('Bearer secret-key')
    expect((captured.body as { model: string }).model).toBe('test-embed')
  })

  it('ném lỗi provider rõ ràng khi dịch vụ trả lỗi', async () => {
    server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end('{"error":"embeddings not supported"}')
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as AddressInfo).port
    const provider = new RemoteEmbeddingProvider({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'x' })
    await expect(provider.embed(['a'])).rejects.toThrow(/400/)
  })
})

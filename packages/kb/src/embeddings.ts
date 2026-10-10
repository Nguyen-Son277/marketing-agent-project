/**
 * Nhúng vector (embedding) cho kho kiến thức, tách khỏi tầng lưu trữ để có thể
 * chạy ONNX cục bộ, gọi dịch vụ OpenAI-compatible, hoặc dùng bản băm tất định.
 *
 * Vì sao có ba hiện thực: môi trường thật nên chạy model cục bộ để dữ liệu công
 * ty không rời máy; một số tổ chức lại có dịch vụ nhúng riêng; còn test/CI phải
 * chạy offline và tất định. `createEmbeddingProvider()` mặc định chọn local và
 * TỰ ĐỘNG rơi về bản băm khi chưa cài model, nhờ vậy hệ thống vẫn khởi động và
 * tìm kiếm từ khoá vẫn hoạt động thay vì chết vì thiếu dependency.
 *
 * Lưu ý đã kiểm chứng: gateway LLM nội bộ (http://localhost:20128/v1) KHÔNG hỗ
 * trợ /embeddings (trả 400), nên không được lấy nó làm EMBEDDING_BASE_URL.
 */
import { needsConfiguration, providerError } from '@marketing-agent/shared'
import { normalizeVector } from '@marketing-agent/db'

export interface EmbeddingProvider {
  /** Định danh model; được lưu vào kb_embeddings để không trộn các không gian vector. */
  readonly name: string
  readonly dim: number
  embed(texts: readonly string[]): Promise<Float32Array[]>
  /** Kiểm tra provider sẵn sàng mà không cần nhúng nội dung thật; dùng cho fallback. */
  probe?(): Promise<boolean>
}

export type EmbeddingProviderKind = 'local' | 'remote' | 'hash'

export const DEFAULT_LOCAL_EMBEDDING_MODEL = 'Xenova/multilingual-e5-small'
export const DEFAULT_REMOTE_EMBEDDING_MODEL = 'text-embedding-3-small'
const TRANSFORMERS_PACKAGE = '@xenova/transformers'
const DEFAULT_HASH_DIM = 256

/* ------------------------------------------------------------- hash (offline) */

export interface HashEmbeddingOptions {
  readonly dim?: number
}

/**
 * Bag-of-words băm vào `dim` chiều rồi chuẩn hoá L2 — tất định, không mạng.
 * Từ trùng nhau cho cùng chỉ số nên hai văn bản chia sẻ từ vựng có cosine cao
 * hơn hai văn bản xa nhau, đủ để test retrieval và làm phương án dự phòng.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly name: string
  readonly dim: number

  constructor(options: HashEmbeddingOptions = {}) {
    this.dim = Math.max(32, Math.floor(options.dim ?? DEFAULT_HASH_DIM))
    this.name = `hash-bow-${this.dim}`
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    return texts.map((text) => this.vectorize(text))
  }

  async probe(): Promise<boolean> {
    return true
  }

  /** Vector của một văn bản; tách riêng để test khỏi phải await. */
  vectorize(text: string): Float32Array {
    const vector = new Float32Array(this.dim)
    for (const token of tokenize(text)) {
      const index = fnv1a(token) % this.dim
      vector[index] = (vector[index] ?? 0) + 1
    }
    return normalizeVector(vector)
  }
}

/** Tách từ theo Unicode cho tiếng Việt; giữ chữ số để bắt "699.000đ" → 699, 000. */
export function tokenize(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

/** FNV-1a 32-bit: nhỏ, nhanh, phân bố đủ đều cho băm từ vựng. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/* ------------------------------------------------------- remote (HTTP API) */

export interface RemoteEmbeddingOptions {
  /** Gốc API, thường kết thúc bằng /v1; provider tự thêm /embeddings. */
  readonly baseUrl: string
  readonly model: string
  readonly apiKey?: string
  readonly dim?: number
  readonly batchSize?: number
  readonly timeoutMs?: number
}

/** Gọi `POST {baseUrl}/embeddings` theo chuẩn OpenAI. */
export class RemoteEmbeddingProvider implements EmbeddingProvider {
  readonly name: string
  private readonly baseUrl: string
  private readonly model: string
  private readonly apiKey: string | undefined
  private readonly batchSize: number
  private readonly timeoutMs: number
  private resolvedDim: number

  constructor(options: RemoteEmbeddingOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.model = options.model
    this.apiKey = options.apiKey
    this.batchSize = Math.max(1, options.batchSize ?? 32)
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? 30_000)
    this.resolvedDim = options.dim ?? 0
    this.name = `remote:${this.model}`
  }

  get dim(): number {
    return this.resolvedDim
  }

  async probe(): Promise<boolean> {
    return true
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    const input = [...texts]
    if (input.length === 0) return []
    const out: Float32Array[] = []
    for (let offset = 0; offset < input.length; offset += this.batchSize) {
      const batch = input.slice(offset, offset + this.batchSize)
      const vectors = await this.embedBatch(batch)
      out.push(...vectors)
    }
    return out
  }

  private async embedBatch(batch: readonly string[]): Promise<Float32Array[]> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: this.model, input: batch }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (cause) {
      throw providerError(`Không gọi được dịch vụ nhúng tại ${this.baseUrl}`, { cause })
    }
    if (!response.ok) {
      throw providerError(`Dịch vụ nhúng ${this.baseUrl} trả lỗi ${response.status}${await errorDetail(response)}`)
    }

    const payload = (await response.json()) as { data?: { embedding?: unknown; index?: unknown }[] }
    const items = Array.isArray(payload.data) ? [...payload.data] : []
    if (items.length !== batch.length) {
      throw providerError(`Dịch vụ nhúng trả về ${items.length} vector cho ${batch.length} đoạn`)
    }
    items.sort((a, b) => numeric(a.index) - numeric(b.index))

    const vectors: Float32Array[] = []
    for (const item of items) {
      const vector = toFloat32(item.embedding)
      if (!vector) throw providerError('Dịch vụ nhúng trả về vector không hợp lệ')
      if (this.resolvedDim === 0) this.resolvedDim = vector.length
      if (vector.length !== this.resolvedDim) {
        throw providerError(`Vector trả về có ${vector.length} chiều, lệch với ${this.resolvedDim} chiều đã thiết lập`)
      }
      vectors.push(vector)
    }
    return vectors
  }
}

/* ------------------------------------------------------ local ONNX (mặc định) */

export interface LocalOnnxOptions {
  readonly model?: string
  readonly dim?: number
}

type FeatureExtractor = (
  input: unknown,
  options?: Record<string, unknown>,
) => Promise<{ data: ArrayLike<number>; dims?: readonly number[] }>

/**
 * Chạy model ONNX trong tiến trình qua @xenova/transformers. Repo không cho
 * thêm dependency nên gói này là tuỳ chọn: chỉ nạp khi thực sự dùng, và ném lỗi
 * cấu hình kèm hướng dẫn cài nếu thiếu.
 */
export class LocalOnnxEmbeddingProvider implements EmbeddingProvider {
  readonly name: string
  private readonly model: string
  private resolvedDim: number
  private extractor: FeatureExtractor | null = null
  private loading: Promise<FeatureExtractor> | null = null

  constructor(options: LocalOnnxOptions = {}) {
    this.model = options.model?.trim() || DEFAULT_LOCAL_EMBEDDING_MODEL
    this.resolvedDim = options.dim ?? 0
    this.name = `local-onnx:${this.model}`
  }

  get dim(): number {
    return this.resolvedDim
  }

  async probe(): Promise<boolean> {
    try {
      await this.embed(['ping'])
      return true
    } catch {
      return false
    }
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    const input = [...texts]
    if (input.length === 0) return []
    const extractor = await this.load()
    const tensor = await extractor(input, { pooling: 'mean', normalize: true })
    const data = tensor.data
    const dim = this.resolvedDim > 0 ? this.resolvedDim : (tensor.dims?.at(-1) ?? 0)
    if (dim <= 0) {
      throw needsConfiguration(`Model ONNX "${this.model}" không trả về chiều vector hợp lệ`)
    }
    this.resolvedDim = dim
    const out: Float32Array[] = []
    for (let row = 0; row < input.length; row++) {
      const vector = new Float32Array(dim)
      for (let col = 0; col < dim; col++) vector[col] = Number(data[row * dim + col] ?? 0)
      out.push(normalizeVector(vector))
    }
    return out
  }

  private async load(): Promise<FeatureExtractor> {
    if (this.extractor) return this.extractor
    if (!this.loading) this.loading = this.createExtractor()
    return this.loading
  }

  private async createExtractor(): Promise<FeatureExtractor> {
    // Import qua biến kiểu string để TypeScript không bắt buộc gói tuỳ chọn này phải tồn tại.
    const moduleName: string = TRANSFORMERS_PACKAGE
    let module: Record<string, unknown>
    try {
      module = (await import(/* @vite-ignore */ moduleName)) as Record<string, unknown>
    } catch (cause) {
      this.loading = null
      throw needsConfiguration(
        `Chưa cài "${TRANSFORMERS_PACKAGE}" nên không chạy được embedding cục bộ. ` +
          `Cài bằng "pnpm add @xenova/transformers", hoặc đặt EMBEDDING_PROVIDER=hash để dùng bản offline, ` +
          `hoặc EMBEDDING_PROVIDER=remote kèm EMBEDDING_BASE_URL trỏ tới dịch vụ /v1/embeddings.`,
        { cause },
      )
    }
    const factory = module.pipeline
    if (typeof factory !== 'function') {
      this.loading = null
      throw needsConfiguration(`Gói "${TRANSFORMERS_PACKAGE}" không export hàm pipeline() như mong đợi`)
    }
    try {
      const extractor = (await (factory as (task: string, model: string) => Promise<unknown>)(
        'feature-extraction',
        this.model,
      )) as FeatureExtractor
      this.extractor = extractor
      return extractor
    } catch (cause) {
      this.loading = null
      throw needsConfiguration(
        `Không nạp được model ONNX "${this.model}". Lần chạy đầu cần mạng để tải model, ` +
          `hoặc chọn EMBEDDING_PROVIDER=hash / remote.`,
        { cause },
      )
    }
  }
}

/* ------------------------------------------------------------- factory */

export interface EmbeddingConfig {
  readonly provider?: EmbeddingProviderKind
  readonly model?: string
  readonly baseUrl?: string
  readonly apiKey?: string
  readonly dim?: number
  readonly logger?: (message: string, data?: unknown) => void
}

/** Đọc cấu hình provider từ biến môi trường; không ném lỗi với giá trị lạ. */
export function embeddingConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingConfig {
  const provider = parseProviderKind(env.EMBEDDING_PROVIDER)
  const model = env.EMBEDDING_MODEL?.trim()
  const baseUrl = env.EMBEDDING_BASE_URL?.trim()
  const apiKey = env.EMBEDDING_API_KEY?.trim()
  const dim = Number.parseInt(env.EMBEDDING_DIM ?? '', 10)
  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(Number.isFinite(dim) && dim > 0 ? { dim } : {}),
  }
}

/**
 * Chọn provider theo cấu hình (mặc định local). Nếu local không khả dụng, GHI
 * LOG rõ ràng rồi rơi về HashEmbeddingProvider để index/retrieval vẫn chạy;
 * vector từ hai provider khác nhau không bị trộn vì `name` được lưu kèm.
 */
export async function createEmbeddingProvider(config: EmbeddingConfig = {}): Promise<EmbeddingProvider> {
  const merged: EmbeddingConfig = { ...embeddingConfigFromEnv(), ...config }
  const logger = merged.logger ?? defaultLogger
  const dim = merged.dim

  if (merged.provider === 'hash') {
    return new HashEmbeddingProvider(dim === undefined ? {} : { dim })
  }

  if (merged.provider === 'remote') {
    const baseUrl = merged.baseUrl?.trim()
    if (!baseUrl) {
      logger('EMBEDDING_BASE_URL trống nên không dùng được provider remote — tạm dùng HashEmbeddingProvider (offline).')
      return new HashEmbeddingProvider(dim === undefined ? {} : { dim })
    }
    return new RemoteEmbeddingProvider({
      baseUrl,
      model: merged.model?.trim() || DEFAULT_REMOTE_EMBEDDING_MODEL,
      ...(merged.apiKey ? { apiKey: merged.apiKey } : {}),
      ...(dim === undefined ? {} : { dim }),
    })
  }

  const local = new LocalOnnxEmbeddingProvider({
    model: merged.model?.trim() || DEFAULT_LOCAL_EMBEDDING_MODEL,
    ...(dim === undefined ? {} : { dim }),
  })
  try {
    if (await local.probe()) return local
    logger(
      `Không nạp được embedding cục bộ ("${local.name}") — đang dùng HashEmbeddingProvider để chạy offline. ` +
        `Cài "@xenova/transformers" hoặc đặt EMBEDDING_PROVIDER=remote để có vector ngữ nghĩa thật.`,
    )
  } catch (error) {
    logger(`Embedding cục bộ lỗi cấu hình: ${errorMessage(error)} — tạm dùng HashEmbeddingProvider.`)
  }
  return new HashEmbeddingProvider(dim === undefined ? {} : { dim })
}

function parseProviderKind(value: string | undefined): EmbeddingProviderKind | undefined {
  const kind = value?.trim().toLowerCase()
  return kind === 'local' || kind === 'remote' || kind === 'hash' ? kind : undefined
}

function defaultLogger(message: string, data?: unknown): void {
  if (data === undefined) console.warn(`[kb] ${message}`)
  else console.warn(`[kb] ${message}`, data)
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function toFloat32(value: unknown): Float32Array | null {
  if (value instanceof Float32Array) return value
  if (Array.isArray(value)) return Float32Array.from(value.map((n) => Number(n) || 0))
  return null
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const text = (await response.text()).slice(0, 300).trim()
    return text ? `: ${text}` : ''
  } catch {
    return ''
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

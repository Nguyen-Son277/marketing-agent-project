/**
 * Tìm kiếm lai (hybrid) trong kho kiến thức: FTS5 từ khoá + cosine vector, hợp
 * nhất bằng Reciprocal Rank Fusion, sau khi đã lọc theo quyền đọc của agent.
 *
 * Vì sao lọc quyền TRƯỚC khi xếp hạng: nếu lọc sau, thứ hạng và điểm số sẽ phụ
 * thuộc vào dữ liệu agent không được phép thấy (rò rỉ qua điểm/rank), và một
 * danh mục cấm vẫn có thể chiếm hết top-K khiến agent nhận về ít kết quả hợp lệ.
 * Vì sao RRF thay vì cộng điểm thô: điểm BM25 và cosine không cùng thang đo, còn
 * RRF chỉ cần thứ hạng nên ổn định và không phải cân chỉnh trọng số.
 */
import { clamp, type KbHit } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import type { EmbeddingProvider } from './embeddings.ts'

/** Hằng số làm phẳng của RRF; 60 là giá trị chuẩn trong tài liệu về RRF. */
export const RRF_K = 60
export const DEFAULT_RETRIEVE_K = 8
const DEFAULT_CANDIDATES = 40

export interface RetrieveOptions {
  readonly companyId: string
  readonly agentDefId: string
  readonly query: string
  readonly k?: number
  /** Không truyền thì chỉ tìm theo từ khoá. */
  readonly embeddingProvider?: EmbeddingProvider
  /** Model đã dùng để nhúng; mặc định là tên provider để không trộn không gian vector. */
  readonly model?: string
  /** Thu hẹp thêm trong tập danh mục agent được đọc (không bao giờ mở rộng). */
  readonly categories?: readonly string[]
}

interface Merged {
  chunkId: string
  score: number
  lexicalRank: number | null
  vectorRank: number | null
}

/**
 * Trả tối đa `k` đoạn phù hợp kèm provenance. Trả `[]` ngay khi agent không
 * được đọc danh mục nào, hoặc khi truy vấn rỗng.
 */
export async function retrieve(repos: Repos, options: RetrieveOptions): Promise<KbHit[]> {
  const query = options.query.trim()
  if (!query) return []

  const readable = repos.team.readableCategories(options.companyId, options.agentDefId)
  if (readable.length === 0) return []
  const categories = options.categories?.length
    ? readable.filter((category) => options.categories!.includes(category))
    : readable
  if (categories.length === 0) return []

  const k = clamp(Math.floor(options.k ?? DEFAULT_RETRIEVE_K), 1, 50)
  const candidates = Math.max(DEFAULT_CANDIDATES, k * 5)

  const lexical = repos.knowledge.lexicalSearch(options.companyId, query, { k: candidates, categories })

  let vector: { chunkId: string; score: number }[] = []
  if (options.embeddingProvider) {
    try {
      const [queryVector] = await options.embeddingProvider.embed([query])
      if (queryVector && queryVector.length > 0) {
        vector = repos.knowledge.vectorSearch(options.companyId, queryVector, {
          k: candidates,
          categories,
          model: options.model ?? options.embeddingProvider.name,
        })
      }
    } catch {
      // Vector là lớp tăng cường: lỗi nhúng không được làm hỏng tìm kiếm từ khoá.
      vector = []
    }
  }

  const merged = new Map<string, Merged>()
  lexical.forEach((hit, index) => {
    const rank = index + 1
    const entry = merged.get(hit.chunkId) ?? { chunkId: hit.chunkId, score: 0, lexicalRank: null, vectorRank: null }
    entry.lexicalRank = rank
    entry.score += 1 / (RRF_K + rank)
    merged.set(hit.chunkId, entry)
  })
  vector.forEach((hit, index) => {
    const rank = index + 1
    const entry = merged.get(hit.chunkId) ?? { chunkId: hit.chunkId, score: 0, lexicalRank: null, vectorRank: null }
    entry.vectorRank = rank
    entry.score += 1 / (RRF_K + rank)
    merged.set(hit.chunkId, entry)
  })

  const top = [...merged.values()]
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId))
    .slice(0, k)

  return repos.knowledge.hydrateHits(
    options.companyId,
    top.map((entry) => ({
      chunkId: entry.chunkId,
      score: entry.score,
      lexicalRank: entry.lexicalRank,
      vectorRank: entry.vectorRank,
    })),
  )
}

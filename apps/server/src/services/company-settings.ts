/**
 * Cấu hình vận hành theo công ty và trạng thái tạm giữa các bước chạy kế hoạch.
 *
 * Vì sao cần tệp này: `/run` sinh ra `summary` + `review` (kết quả chạy và kết
 * luận kiểm tra chất lượng), `/report` lại cần đúng hai giá trị đó. Hợp đồng API
 * không có endpoint trung gian nào để giao diện giữ hộ, nên server phải nhớ. Chọn
 * `app_settings` thay vì thêm bảng mới vì đây là dữ liệu ngắn hạn, ghi đè mỗi lần
 * chạy, và không cần truy vấn theo cột — một bảng riêng chỉ thêm migration mà
 * không thêm khả năng nào.
 *
 * Cùng tệp giữ luôn trần chi phí/giới hạn vận hành theo công ty: chúng nằm trong
 * `app_settings` với khoá gắn `companyId`, và được truyền cho orchestrator khi
 * khởi tạo.
 */
import { validation, type LimitsView } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import type { DispatchSummary, OrchestratorLimits, ReviewDecision } from '@marketing-agent/orchestrator'

/**
 * Giá trị mặc định của giới hạn vận hành. Cố ý lặp lại `DEFAULT_LIMITS` của
 * orchestrator thay vì import giá trị runtime: tầng route chỉ nạp orchestrator
 * qua import động (xem `agent-services.ts`), còn hàm đọc giới hạn phải trả lời
 * được kể cả khi gói orchestrator chưa resolve được.
 */
export const DEFAULT_LIMIT_VALUES: OrchestratorLimits = {
  dailyCostUsd: 20,
  taskCostUsd: 2,
  maxStepsPerRun: 12,
  maxPeerRounds: 3,
  maxRevisionsPerTask: 2,
  maxParallelTasks: 3,
}

const LIMIT_KEYS: readonly (keyof OrchestratorLimits)[] = [
  'dailyCostUsd',
  'taskCostUsd',
  'maxStepsPerRun',
  'maxPeerRounds',
  'maxRevisionsPerTask',
  'maxParallelTasks',
]

/** Bản ghi giới hạn có thể gán từng trường (các trường của `OrchestratorLimits` là readonly). */
type MutableLimits = { -readonly [K in keyof OrchestratorLimits]: OrchestratorLimits[K] }

const limitsKey = (companyId: string): string => `limits:${companyId}`
const runStateKey = (companyId: string, conversationId: string): string =>
  `run-state:${companyId}:${conversationId}`

/** Giới hạn đã lưu của công ty, chỉ gồm các khoá có giá trị hợp lệ. */
export function readStoredLimits(repos: Repos, companyId: string): Partial<OrchestratorLimits> {
  const stored = repos.accounting.getSetting<Record<string, unknown>>(limitsKey(companyId))
  if (!stored || typeof stored !== 'object') return {}
  const out: Partial<MutableLimits> = {}
  for (const key of LIMIT_KEYS) {
    const value = stored[key]
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
}

/** Giới hạn hiệu lực, kèm chi phí đã dùng trong 24 giờ để giao diện vẽ thanh tiến độ. */
export function readLimitsView(repos: Repos, companyId: string): LimitsView {
  const limits = { ...DEFAULT_LIMIT_VALUES, ...readStoredLimits(repos, companyId) }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const usedTodayUsd = repos.accounting.usageSince(companyId, since).costUsd
  return { ...limits, usedTodayUsd }
}

/** Ghi đè một phần giới hạn; giá trị không hợp lệ bị từ chối trước khi lưu. */
export function saveLimits(repos: Repos, companyId: string, patch: Partial<OrchestratorLimits>): LimitsView {
  const merged = { ...readStoredLimits(repos, companyId), ...patch }
  for (const key of LIMIT_KEYS) {
    const value = merged[key]
    if (value === undefined) continue
    const lowerBound = key === 'maxStepsPerRun' || key === 'maxParallelTasks' ? 1 : 0
    if (!Number.isFinite(value) || value < lowerBound) {
      throw validation(`Giới hạn ${key} phải là số ≥ ${lowerBound}`)
    }
  }
  repos.accounting.setSetting(limitsKey(companyId), merged)
  return readLimitsView(repos, companyId)
}

export interface StoredRunState {
  readonly summary: DispatchSummary
  readonly review: ReviewDecision
  readonly savedAt: string
}

/** Lưu kết quả lượt chạy để `/report` dùng lại; ghi đè lượt trước của cùng phiên. */
export function saveRunState(
  repos: Repos,
  companyId: string,
  conversationId: string,
  state: { summary: DispatchSummary; review: ReviewDecision },
): void {
  const payload: StoredRunState = { ...state, savedAt: new Date().toISOString() }
  repos.accounting.setSetting(runStateKey(companyId, conversationId), payload)
}

/** Đọc kết quả lượt chạy gần nhất của một phiên, hoặc undefined nếu chưa chạy. */
export function readRunState(
  repos: Repos,
  companyId: string,
  conversationId: string,
): StoredRunState | undefined {
  const stored = repos.accounting.getSetting<StoredRunState>(runStateKey(companyId, conversationId))
  if (!stored || typeof stored !== 'object') return undefined
  const candidate = stored as Partial<StoredRunState>
  if (!candidate.summary || !candidate.review) return undefined
  return {
    summary: candidate.summary,
    review: candidate.review,
    savedAt: typeof candidate.savedAt === 'string' ? candidate.savedAt : '',
  }
}

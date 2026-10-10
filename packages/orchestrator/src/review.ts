/**
 * ReviewGate: Leader kiểm tra kết quả chuyên môn trước khi tổng hợp báo cáo.
 *
 * Vì sao cần một cổng riêng thay vì tin vào kết quả agent trả về: agent có động cơ
 * hoàn thành việc, không phải động cơ phát hiện lỗi của chính nó. Người kiểm tra
 * khác người làm là điều kiện để việc kiểm tra có ý nghĩa.
 *
 * Việc kiểm tra ở đây là **xác định** (deterministic) cho những gì kiểm được bằng
 * máy — thiếu tài sản, thiếu nguồn, task bị chặn — và chỉ giao cho model phần đánh
 * giá cần phán đoán. Kiểm được bằng máy mà lại hỏi model là tự nguyện chịu rủi ro.
 */
import type { Repos } from '@marketing-agent/db'
import type { AgentRuntimeDeps } from '@marketing-agent/agent-runtime'
import type { EmbeddingProvider } from '@marketing-agent/kb'
import type { ToolRegistry } from '@marketing-agent/tools'
import { runAgentForTask } from './agent-runner.ts'
import type { DispatchSummary, OrchestratorLimits, ReviewDecision, TaskOutcome } from './types.ts'

export interface ReviewInput {
  readonly repos: Repos
  readonly tools: ToolRegistry
  readonly embedding?: EmbeddingProvider | undefined
  readonly runtimeOverrides?: Partial<AgentRuntimeDeps> | undefined
  readonly companyId: string
  readonly conversationId: string | null
  readonly brief: string
  readonly summary: DispatchSummary
  readonly limits: OrchestratorLimits
  readonly log?: ((message: string, data?: unknown) => void) | undefined
}

/** Một vấn đề phát hiện được, kèm mức độ và gợi ý sửa. */
export interface ReviewIssue {
  readonly kind: 'missing_artifact' | 'blocked_task' | 'failed_task' | 'no_sources'
  readonly severity: 'blocker' | 'major' | 'minor'
  readonly taskTitle: string
  readonly detail: string
}

/** Các kiểm tra xác định, không cần gọi model. */
export function mechanicalChecks(summary: DispatchSummary): ReviewIssue[] {
  const issues: ReviewIssue[] = []

  for (const outcome of summary.outcomes) {
    if (outcome.status === 'blocked') {
      issues.push({
        kind: 'blocked_task',
        severity: 'major',
        taskTitle: outcome.title,
        detail: outcome.reason ?? 'Việc bị chặn nhưng không nêu lý do cụ thể.',
      })
      continue
    }
    if (outcome.status === 'failed') {
      issues.push({
        kind: 'failed_task',
        severity: 'blocker',
        taskTitle: outcome.title,
        detail: outcome.reason ?? 'Việc thất bại nhưng không nêu lý do cụ thể.',
      })
      continue
    }
    // Một việc "xong" mà không có tài sản nào và kết quả rỗng là dấu hiệu agent
    // tuyên bố hoàn thành mà không thực sự làm gì.
    if (outcome.artifactIds.length === 0 && outcome.resultMd.trim().length < 120) {
      issues.push({
        kind: 'missing_artifact',
        severity: 'major',
        taskTitle: outcome.title,
        detail: 'Việc báo hoàn thành nhưng không có tài sản đầu ra và kết quả quá ngắn để dùng được.',
      })
    }
  }

  return issues
}

/**
 * Kiểm tra có nguồn hay không.
 *
 * Không cố diễn giải văn xuôi: chỉ tìm dấu hiệu nguồn cụ thể (đường dẫn kho kiến
 * thức, URL, hoặc ghi chú từ tool). Đây là kiểm tra thô nhưng bắt được trường hợp
 * phổ biến nhất — một kết quả toàn khẳng định không dẫn nguồn nào.
 */
export function hasSourceEvidence(text: string): boolean {
  const markers = [
    /https?:\/\/\S+/i,
    /`?[0-9]{2}-[a-z0-9-]+\/[a-z0-9./-]+\.md`?/i,
    /nguồn\s*:/i,
    /theo\s+(ga4|gsc|google search console|search console|meta|linkedin)/i,
    /gsc\.query|ga4\.report|kb\.search|web\.scrape|web\.search/i,
  ]
  return markers.some((marker) => marker.test(text))
}

/** Bổ sung kiểm tra nguồn cho các việc có nội dung định lượng. */
export function sourceChecks(summary: DispatchSummary): ReviewIssue[] {
  const issues: ReviewIssue[] = []
  for (const outcome of summary.outcomes) {
    if (outcome.status !== 'done') continue
    if (outcome.resultMd.trim().length < 200) continue
    if (!hasSourceEvidence(outcome.resultMd)) {
      issues.push({
        kind: 'no_sources',
        severity: 'minor',
        taskTitle: outcome.title,
        detail: 'Kết quả không dẫn nguồn nào (tài liệu kho kiến thức hoặc kết quả công cụ).',
      })
    }
  }
  return issues
}

/**
 * Quyết định duyệt hay trả lại.
 *
 * Có `blocker` thì luôn trả lại. Chỉ có `major`/`minor` thì để Leader quyết định
 * bằng model — vì đôi khi một việc `blocked` là kết quả đúng và đủ để báo cáo
 * (ví dụ thiếu dữ liệu và ta phải nói thẳng là thiếu).
 */
export async function reviewOutcomes(input: ReviewInput): Promise<ReviewDecision> {
  const issues = [...mechanicalChecks(input.summary), ...sourceChecks(input.summary)]

  const blockers = issues.filter((issue) => issue.severity === 'blocker')
  if (blockers.length > 0) {
    return {
      verdict: 'revise',
      issues: issues.map(describeIssue),
      noteMd: buildReviewNote(issues, 'Có việc thất bại nên không thể tổng hợp báo cáo như đã cam kết.'),
    }
  }

  if (issues.length === 0) {
    return {
      verdict: 'pass',
      issues: [],
      noteMd: 'Tất cả công việc hoàn thành, có tài sản đầu ra và có dẫn nguồn.',
    }
  }

  // Chỉ còn vấn đề không chặn: hỏi Leader để phán đoán, và luôn có đường thoái lui
  // nếu lượt gọi model không dùng được.
  try {
    const judgement = await askLeaderToJudge(input, issues)
    return judgement
  } catch (error) {
    input.log?.('Không gọi được Leader để đánh giá; dùng quy tắc xác định', {
      error: error instanceof Error ? error.message : String(error),
    })
    // Thà duyệt kèm cảnh báo còn hơn chặn báo cáo vì một lỗi hạ tầng.
    return {
      verdict: 'pass',
      issues: issues.map(describeIssue),
      noteMd: buildReviewNote(
        issues,
        'Đã duyệt kèm cảnh báo (không đánh giá được bằng model). Người dùng nên đọc kỹ các điểm dưới đây.',
      ),
    }
  }
}

async function askLeaderToJudge(input: ReviewInput, issues: readonly ReviewIssue[]): Promise<ReviewDecision> {
  const outcomesText = input.summary.outcomes
    .map(
      (outcome) =>
        `- ${outcome.title} (${outcome.assigneeRole}) — ${outcome.status}` +
        (outcome.run ? ` · ${outcome.run.steps} bước · ${outcome.run.usage.costUsd.toFixed(4)} USD` : ''),
    )
    .join('\n')

  const issuesText = issues.map((issue) => `- [${issue.severity}] ${issue.taskTitle}: ${issue.detail}`).join('\n')

  const result = await runAgentForTask({
    repos: input.repos,
    tools: input.tools,
    embedding: input.embedding,
    runtimeOverrides: input.runtimeOverrides,
    companyId: input.companyId,
    role: 'marketing-leader',
    taskId: null,
    conversationId: input.conversationId,
    maxSteps: 3,
    taskBrief: [
      'Bạn đang ở bước KIỂM TRA CHẤT LƯỢNG trước khi viết báo cáo cho người dùng.',
      '',
      '## Mục tiêu đã chốt với người dùng',
      input.brief,
      '',
      '## Kết quả các công việc',
      outcomesText,
      '',
      '## Vấn đề hệ thống phát hiện được',
      issuesText,
      '',
      '## Việc của bạn',
      'Quyết định: DUYỆT để viết báo cáo ngay, hay TRẢ LẠI để sửa.',
      'Chỉ trả lại khi vấn đề làm kết quả không dùng được cho mục tiêu đã chốt.',
      'Một việc bị chặn vì thiếu dữ liệu có thể là kết quả ĐÚNG — khi đó hãy duyệt và nói rõ phần nào chưa có.',
      '',
      'Trả lời theo đúng định dạng:',
      'DÒNG 1: PASS hoặc REVISE',
      'PHẦN CÒN LẠI: lý do ngắn, và nếu REVISE thì nêu chính xác cần sửa gì.',
    ].join('\n'),
    ...(input.log ? { log: input.log } : {}),
  })

  const text = result.run.output.trim()
  const verdict = /^\s*REVISE/i.test(text) ? 'revise' : 'pass'
  return {
    verdict,
    issues: issues.map(describeIssue),
    noteMd: text.length > 0 ? text : buildReviewNote(issues, 'Leader không nêu lý do.'),
  }
}

function describeIssue(issue: ReviewIssue): string {
  const label = issue.severity === 'blocker' ? 'Chặn' : issue.severity === 'major' ? 'Cao' : 'Thấp'
  return `[${label}] ${issue.taskTitle}: ${issue.detail}`
}

function buildReviewNote(issues: readonly ReviewIssue[], headline: string): string {
  return [headline, '', ...issues.map((issue) => `- ${describeIssue(issue)}`)].join('\n')
}

/** Số vòng sửa còn lại cho một việc, theo trần cấu hình. */
export function revisionsRemaining(outcome: TaskOutcome, limits: OrchestratorLimits): number {
  const task = outcome as TaskOutcome & { revisionCount?: number }
  const used = task.revisionCount ?? 0
  return Math.max(0, limits.maxRevisionsPerTask - used)
}

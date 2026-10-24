/**
 * Reporter: tổng hợp kết quả thành báo cáo cho người dùng.
 *
 * Báo cáo có cấu trúc bảy mục cố định. Mục quan trọng nhất là mục đầu: người bận
 * chỉ đọc "Tóm tắt điều hành" vẫn phải nắm được tình hình và biết cần quyết định gì.
 *
 * Nguồn số liệu chi phí là bảng `usage_daily`/`runs` (số thật đã ghi), không phải
 * con số do model tự khai — model có xu hướng làm tròn hoặc bịa chi phí.
 */
import type { Repos } from '@marketing-agent/db'
import type { DispatchSummary, ReportResult, ReviewDecision, TaskOutcome } from './types.ts'

export interface BuildReportInput {
  readonly repos: Repos
  readonly companyId: string
  readonly conversationId: string | null
  readonly title: string
  readonly brief: string
  readonly summary: DispatchSummary
  readonly review: ReviewDecision
  /** Chi phí của cả phiên, lấy từ sổ chi phí. */
  readonly costUsd: number
}

/** Dựng Markdown báo cáo từ kết quả thật. */
export function composeReport(input: BuildReportInput): string {
  const done = input.summary.outcomes.filter((outcome) => outcome.status === 'done')
  const pending = input.summary.outcomes.filter((outcome) => outcome.status !== 'done')

  const sections: string[] = []
  sections.push(`# ${input.title}`)
  sections.push(`_Tạo lúc ${new Date().toISOString()} · chi phí ${input.costUsd.toFixed(4)} USD_`)

  sections.push('## 1. Tóm tắt điều hành')
  sections.push(executiveSummary(input, done, pending))

  const productImages = input.repos.knowledge.listProductImages(input.companyId, input.brief, 3)
  if (productImages.length > 0) {
    sections.push('## Hình ảnh sản phẩm')
    sections.push(
      productImages
        .map((image) => {
          const url = `/api/companies/${encodeURIComponent(input.companyId)}/knowledge/${encodeURIComponent(image.id)}/original`
          const description = image.imageDescription ? ` — ${image.imageDescription}` : ''
          return `![${image.title}](${url})\n\n*${image.title}${description}*`
        })
        .join('\n\n'),
    )
  }

  sections.push('## 2. Kết quả theo mục tiêu')
  sections.push(...outcomeSections(input.summary.outcomes))

  sections.push('## 3. Bằng chứng & nguồn')
  sections.push(evidenceSection(input.summary.outcomes))

  sections.push('## 4. Chi phí & thời gian')
  sections.push(costSection(input))

  sections.push('## 5. Rủi ro & giả định')
  sections.push(riskSection(input))

  sections.push('## 6. Đề xuất bước tiếp theo')
  sections.push(nextSteps(input))

  sections.push('## 7. Phụ lục')
  sections.push(annexSection(input.summary.outcomes))

  return sections.join('\n\n')
}

function executiveSummary(input: BuildReportInput, done: readonly TaskOutcome[], pending: readonly TaskOutcome[]): string {
  const lines: string[] = []
  lines.push(
    `Đã hoàn thành **${done.length}/${input.summary.outcomes.length}** công việc` +
      (pending.length > 0 ? `, còn **${pending.length}** việc chưa xong.` : '.'),
  )
  if (done.length > 0) {
    lines.push('')
    lines.push('Kết quả chính:')
    for (const outcome of done.slice(0, 5)) {
      lines.push(`- **${outcome.title}** — ${firstSentence(outcome.resultMd)}`)
    }
    if (done.length > 5) lines.push(`- …và ${done.length - 5} việc khác (xem mục 7).`)
  }
  if (pending.length > 0) {
    lines.push('')
    lines.push('Chưa xong:')
    for (const outcome of pending) {
      lines.push(`- **${outcome.title}** (${outcome.status}) — ${outcome.reason ?? 'không rõ lý do'}`)
    }
  }
  lines.push('')
  lines.push(
    `**Cần quyết định:** ${pending.length > 0 ? 'bổ sung dữ liệu hoặc phê duyệt cho các việc còn lại' : 'phê duyệt để triển khai và chuyển sang bước đo lường'}.`,
  )
  lines.push('')
  lines.push(`_Ghi chú kiểm tra chất lượng: ${input.review.verdict === 'pass' ? 'đạt' : 'cần sửa'}._`)
  return lines.join('\n')
}

function outcomeSections(outcomes: readonly TaskOutcome[]): string[] {
  const blocks: string[] = []
  for (const outcome of outcomes) {
    const badge = outcome.status === 'done' ? '✅' : outcome.status === 'blocked' ? '⏸️' : '❌'
    blocks.push(`### ${badge} ${outcome.title} — ${outcome.assigneeRole}`)
    blocks.push(outcome.resultMd.trim().length > 0 ? outcome.resultMd.trim() : '_Không có kết quả._')
    blocks.push('')
  }
  return blocks
}

function evidenceSection(outcomes: readonly TaskOutcome[]): string {
  const rows: string[] = ['| Công việc | Tài sản | Ghi chú |', '|---|---|---|']
  for (const outcome of outcomes) {
    const artifacts = outcome.artifactIds.length > 0 ? outcome.artifactIds.join(', ') : '—'
    rows.push(`| ${outcome.title} | ${artifacts} | ${outcome.status} |`)
  }
  rows.push('')
  rows.push(
    'Nguồn số liệu: tài liệu trong kho kiến thức công ty và kết quả công cụ (Google Search Console, ' +
      'GA4, Firecrawl, Meta, LinkedIn) ghi trong phần kết quả từng việc. Chỉ số nào không lấy được ' +
      'nguồn đều đã được ghi rõ là chưa có dữ liệu.',
  )
  return rows.join('\n')
}

function costSection(input: BuildReportInput): string {
  const rows: string[] = ['| Công việc | Agent | Bước | Token | Chi phí (USD) |', '|---|---|---|---|---|']
  let tokens = 0
  let cost = 0
  for (const outcome of input.summary.outcomes) {
    if (!outcome.run) continue
    const used = outcome.run.usage.tokensIn + outcome.run.usage.tokensOut
    tokens += used
    cost += outcome.run.usage.costUsd
    rows.push(
      `| ${outcome.title} | ${outcome.assigneeRole} | ${outcome.run.steps} | ${used} | ${outcome.run.usage.costUsd.toFixed(4)} |`,
    )
  }
  rows.push('')
  rows.push(`**Tổng theo lượt chạy:** ${tokens} token · ${cost.toFixed(4)} USD`)
  rows.push('')
  rows.push(`**Tổng ghi trong sổ chi phí của phiên:** ${input.costUsd.toFixed(4)} USD`)
  if (input.summary.outcomes.some((outcome) => outcome.run === null)) {
    rows.push('')
    rows.push('_Một số việc không có số liệu lượt chạy vì chưa chạy được._')
  }
  return rows.join('\n')
}

function riskSection(input: BuildReportInput): string {
  const lines: string[] = []
  const failed = input.summary.outcomes.filter((outcome) => outcome.status !== 'done')
  if (failed.length > 0) {
    lines.push('Rủi ro đã biết:')
    for (const outcome of failed) {
      lines.push(`- **${outcome.title}** chưa xong: ${outcome.reason ?? 'không rõ lý do'}`)
    }
  } else {
    lines.push('Không có công việc nào thất bại trong lượt này.')
  }
  if (input.review.issues.length > 0) {
    lines.push('')
    lines.push('Điểm cần lưu ý từ bước kiểm tra:')
    for (const issue of input.review.issues) lines.push(`- ${issue}`)
  }
  lines.push('')
  lines.push(
    'Giả định: các số liệu hiệu suất phụ thuộc vào việc kết nối đúng tài khoản (GA4, Search Console, ' +
      'Meta, LinkedIn). Nếu một kết nối chưa có, phần tương ứng đã được ghi rõ là thiếu dữ liệu ' +
      'thay vì suy đoán.',
  )
  return lines.join('\n')
}

function nextSteps(input: BuildReportInput): string {
  const steps: string[] = []
  const blocked = input.summary.outcomes.filter((outcome) => outcome.status === 'blocked')
  if (blocked.length > 0) {
    steps.push('1. Gỡ chặn cho các việc đang dừng: ' + blocked.map((outcome) => outcome.title).join(', ') + '.')
  }
  steps.push(
    `${steps.length + 1}. Phê duyệt nội dung/kế hoạch đã soạn và tiến hành triển khai theo lịch.`,
  )
  steps.push(
    `${steps.length + 1}. Kết nối các nguồn dữ liệu còn thiếu (GA4, Search Console, Meta, LinkedIn) để lượt sau có số liệu thật.`,
  )
  steps.push(`${steps.length + 1}. Đặt lịch đo kết quả theo KPI đã chốt và giao cho Analytics tổng hợp.`)
  return steps.join('\n')
}

function annexSection(outcomes: readonly TaskOutcome[]): string {
  const lines: string[] = []
  for (const outcome of outcomes) {
    lines.push(`- **${outcome.title}** — ${outcome.status}`)
    if (outcome.artifactIds.length > 0) {
      lines.push(`  - Tài sản: ${outcome.artifactIds.join(', ')}`)
    }
    if (outcome.run) {
      lines.push(
        `  - Lượt chạy: ${outcome.run.runId ?? 'không rõ'} · ${outcome.run.steps} bước · dừng vì ${outcome.run.stopReason}`,
      )
    }
  }
  return lines.length > 0 ? lines.join('\n') : '_Không có phụ lục._'
}

/** Câu đầu tiên của kết quả, dùng cho phần tóm tắt điều hành. */
export function firstSentence(text: string, maxChars = 180): string {
  const cleaned = text
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length === 0) return 'không có nội dung'
  const stop = cleaned.search(/[.!?]\s/)
  const sentence = stop > 20 && stop < maxChars ? cleaned.slice(0, stop + 1) : cleaned.slice(0, maxChars)
  return sentence.length < cleaned.length ? `${sentence}…` : sentence
}

/** Tạo tài sản báo cáo và trả về kết quả. */
export function persistReport(
  input: BuildReportInput,
  markdown: string,
): ReportResult {
  const artifact = input.repos.work.addArtifact({
    companyId: input.companyId,
    taskId: null,
    name: input.title,
    kind: 'markdown',
    content: markdown,
    meta: {
      kind: 'final-report',
      conversationId: input.conversationId,
      costUsd: input.costUsd,
      reviewVerdict: input.review.verdict,
    },
  })
  return { markdown, artifactId: artifact.id, costUsd: input.costUsd }
}

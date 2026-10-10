/**
 * Chi phí, lượt chạy và nhật ký kiểm toán của một công ty.
 *
 * Vì sao gộp ba thứ này: chúng là ba góc nhìn của cùng một câu hỏi "tiền và việc
 * đã đi đâu". Số liệu lấy từ bảng đã ghi (`runs`, `usage_daily`, `audit_log`),
 * không tính lại từ hội thoại — nếu không, hai màn hình sẽ cho hai con số khác nhau.
 */
import { validation } from '@marketing-agent/shared'
import type { CostsResponse, CostAgentRow, CostDayRow } from '@marketing-agent/shared'
import type { AppContext } from '../context.ts'
import { requireMembership } from '../http/middleware.ts'
import type { Router } from '../http/router.ts'
import { toRunView } from '../services/view-mappers.ts'

export function costRoutes() {
  return {
    name: 'costs',
    register(router: Router, ctx: AppContext): void {
      const repos = ctx.repos

      router.get(
        '/api/companies/:companyId/costs',
        async (request) => {
          const companyId = request.params.companyId!
          const today = new Date().toISOString().slice(0, 10)
          const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
          const from = normalizeDay(request.query('from'), defaultFrom)
          const to = normalizeDay(request.query('to'), today)

          const daily: CostDayRow[] = repos.accounting.dailyUsage(companyId, { from, to })
          const byAgent: CostAgentRow[] = repos.accounting.costByAgent(companyId, { from, to })
          const totals = daily.reduce(
            (sum, row) => ({
              tokensIn: sum.tokensIn + row.tokensIn,
              tokensOut: sum.tokensOut + row.tokensOut,
              costUsd: sum.costUsd + row.costUsd,
              runs: sum.runs + row.runs,
            }),
            { tokensIn: 0, tokensOut: 0, costUsd: 0, runs: 0 },
          )

          const response: CostsResponse = {
            totals: { ...totals, costUsd: round6(totals.costUsd) },
            daily,
            byAgent,
            runs: repos.accounting.listRuns(companyId, { limit: 50 }).map((run) => toRunView(run)),
          }
          request.json(200, response)
        },
        [requireMembership(repos)],
      )

      router.get(
        '/api/companies/:companyId/runs',
        async (request) => {
          const companyId = request.params.companyId!
          const limit = normalizeLimit(request.query('limit'))
          request.json(200, {
            runs: repos.accounting.listRuns(companyId, { limit }).map((run) => toRunView(run)),
          })
        },
        [requireMembership(repos)],
      )

      router.get(
        '/api/companies/:companyId/audit',
        async (request) => {
          const companyId = request.params.companyId!
          const limit = normalizeLimit(request.query('limit'))
          request.json(200, { entries: repos.accounting.listAudit(companyId, limit) })
        },
        [requireMembership(repos)],
      )
    },
  }
}

/** Chấp nhận `YYYY-MM-DD` lẫn ISO datetime; giá trị không đọc được là 400. */
function normalizeDay(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  const dateOnly = /^(\d{4}-\d{2}-\d{2})/.exec(value)
  if (dateOnly?.[1]) return dateOnly[1]
  const parsed = Date.parse(value)
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10)
  throw validation(`Tham số ngày không hợp lệ: "${value}". Dùng định dạng YYYY-MM-DD.`)
}

function normalizeLimit(value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 100
  return Math.min(Math.floor(parsed), 500)
}

/** Làm tròn tới micro-USD, khớp cách sổ chi phí ghi. */
function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

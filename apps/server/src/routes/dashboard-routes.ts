/**
 * Tổng quan công ty và tài sản đầu ra.
 *
 * Vì sao dashboard nằm cùng tài sản đầu ra: màn tổng quan hiển thị "có bao nhiêu
 * việc, tốn bao nhiêu tiền, vừa xảy ra chuyện gì", còn tài sản là thứ người dùng
 * mở ra ngay sau đó. Gộp một module giữ cho lượt tải đầu của giao diện chỉ cần
 * một chỗ để đọc.
 *
 * `main.ts` chỉ dò các module tool|team|knowledge|chat|tasks|settings|costs|diagram,
 * nên module này không có tệp riêng để nạp; `diagram-routes.ts` (đã được dò) gọi
 * `register` của nó. Đây là cách để một route không bị mồ côi.
 */
import type { DashboardResponse, ArtifactView } from '@marketing-agent/shared'
import type { AppContext } from '../context.ts'
import { readTenancy, requireMembership } from '../http/middleware.ts'
import type { Router } from '../http/router.ts'
import { readLimitsView } from '../services/company-settings.ts'
import { artifactMembership } from '../services/resource-access.ts'
import { taskCounts, toArtifactView } from '../services/view-mappers.ts'

export function dashboardRoutes() {
  return {
    name: 'dashboard',
    register(router: Router, ctx: AppContext): void {
      const repos = ctx.repos

      router.get(
        '/api/companies/:companyId/dashboard',
        async (request) => {
          const companyId = request.params.companyId!
          const tenancy = readTenancy(request)
          const company = repos.auth.findCompanyById(companyId)
          if (!company || !tenancy) {
            request.json(404, { error: { code: 'not_found', message: 'Không tìm thấy công ty' } })
            return
          }

          const tasks = repos.work.listTasks(companyId, { limit: 500 })
          const today = new Date().toISOString().slice(0, 10)
          const from30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
          const costToday = sumCost(repos.accounting.dailyUsage(companyId, { from: today, to: today }))
          const cost30 = sumCost(repos.accounting.dailyUsage(companyId, { from: from30, to: today }))
          const defs = repos.team.listAgentDefs()
          const presets = repos.team.listPresets(companyId)

          const response: DashboardResponse = {
            company: {
              id: company.id,
              name: company.name,
              slug: company.slug,
              role: tenancy.role,
            },
            counts: {
              tasks: taskCounts(tasks),
              conversations: repos.work.listConversations(companyId, 1000).length,
              documents: repos.knowledge.stats(companyId).documents,
              agentsEnabled: presets.filter((preset) => preset.enabled).length,
              agentsTotal: defs.length,
            },
            cost: {
              today: costToday,
              last30Days: cost30,
              limitPerDay: readLimitsView(repos, companyId).dailyCostUsd,
            },
            recentActivity: repos.accounting.listAudit(companyId, 10).map((entry) => ({
              at: entry.createdAt,
              kind: entry.action,
              summary: entry.target ?? entry.action,
            })),
          }
          request.json(200, response)
        },
        [requireMembership(repos)],
      )

      router.get(
        '/api/companies/:companyId/artifacts',
        async (request) => {
          const companyId = request.params.companyId!
          const taskId = request.query('taskId')
          const limit = Number(request.query('limit'))
          const artifacts = repos.work
            .listArtifacts(companyId, {
              ...(taskId ? { taskId } : {}),
              limit: Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 200,
            })
            .map((artifact) => toArtifactView(artifact))
          request.json(200, { artifacts })
        },
        [requireMembership(repos)],
      )

      router.get(
        '/api/artifacts/:artifactId',
        async (request) => {
          const tenancy = readTenancy(request)
          if (!tenancy) {
            request.json(404, { error: { code: 'not_found', message: 'Không tìm thấy tài sản đầu ra' } })
            return
          }
          const artifact = repos.work.requireArtifact(request.params.artifactId!, tenancy.companyId)
          const view: ArtifactView = toArtifactView(artifact)
          request.json(200, view)
        },
        [artifactMembership(repos)],
      )
    },
  }
}

function sumCost(rows: readonly { costUsd: number }[]): number {
  const total = rows.reduce((sum, row) => sum + row.costUsd, 0)
  return Math.round(total * 1_000_000) / 1_000_000
}

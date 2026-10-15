/**
 * Công việc trong kế hoạch: danh sách, chi tiết (kèm nhật ký, tài sản, trao đổi
 * giữa các agent), và quyết định review của người dùng.
 *
 * Vì sao chi tiết trả cả nhật ký sự kiện và trao đổi: một công việc "đang chạy"
 * chỉ hữu ích khi người xem biết nó đã làm gì và đang chờ ai. Gom vào một phản hồi
 * để giao diện không phải mở ba lượt gọi cho một thẻ công việc.
 */
import { forbidden, parseOrThrow, reviewTaskSchema } from '@marketing-agent/shared'
import type { ArtifactView, ReviewTaskResponse, TaskDetailResponse, TaskListResponse, TaskStatus } from '@marketing-agent/shared'
import type { AppContext } from '../context.ts'
import { readAuth, requireMembership, requireWork } from '../http/middleware.ts'
import type { RequestContext, Router } from '../http/router.ts'
import { taskMembership } from '../services/resource-access.ts'
import { buildTaskView, buildTaskViews, taskCounts, toArtifactView } from '../services/view-mappers.ts'

export function taskRoutes() {
  return {
    name: 'tasks',
    register(router: Router, ctx: AppContext): void {
      const repos = ctx.repos

      router.get(
        '/api/companies/:companyId/tasks',
        async (request) => {
          const companyId = request.params.companyId!
          const all = repos.work.listTasks(companyId, { limit: 500 })
          const statusFilter = parseStatusFilter(request.query('status'))
          const conversationId = request.query('conversationId')
          const limit = parseLimit(request.query('limit'))

          const filtered = all
            .filter((task) => (statusFilter.length === 0 ? true : statusFilter.includes(task.status)))
            .filter((task) => (conversationId ? task.conversationId === conversationId : true))

          const response: TaskListResponse = {
            tasks: buildTaskViews(repos, companyId, filtered.slice(0, limit)),
            counts: taskCounts(all),
          }
          request.json(200, response)
        },
        [requireMembership(repos)],
      )

      router.get(
        '/api/tasks/:taskId',
        async (request) => {
          const { companyId, taskId } = taskScope(request)
          const task = repos.work.requireTask(taskId, companyId)
          const artifacts: ArtifactView[] = repos.work
            .listArtifacts(companyId, { taskId, limit: 200 })
            .map((artifact) => toArtifactView(artifact))
          const response: TaskDetailResponse = {
            task: buildTaskView(repos, companyId, task),
            events: repos.work.listTaskEvents(taskId, companyId, 200),
            artifacts,
            messages: repos.work.listAgentMessages(companyId, { taskId, limit: 200 }).map((message) => ({
              id: message.id,
              fromAgent: message.fromAgent,
              toAgent: message.toAgent,
              kind: message.kind,
              contentMd: message.contentMd,
              createdAt: message.createdAt,
            })),
          }
          request.json(200, response)
        },
        [taskMembership(repos)],
      )

      router.post(
        '/api/tasks/:taskId/review',
        async (request) => {
          const { companyId, taskId } = taskScope(request)
          const input = parseOrThrow(reviewTaskSchema, await request.body(), 'quyết định review')
          const task = repos.work.requireTask(taskId, companyId)

          let updated = task
          if (input.decision === 'approve') {
            updated = repos.work.setTaskStatus(taskId, companyId, 'done')
          } else if (input.decision === 'cancel') {
            updated = repos.work.setTaskStatus(taskId, companyId, 'cancelled')
          } else {
            updated = repos.work.updateTask(taskId, companyId, {
              status: 'assigned',
              incrementRevision: true,
              resultMd: input.note
                ? `${task.resultMd ?? ''}\n\n---\n\n**Yêu cầu sửa:** ${input.note}`.trim()
                : task.resultMd,
            })
          }

          repos.work.addTaskEvent(taskId, companyId, 'review', { decision: input.decision, note: input.note ?? null })
          repos.accounting.audit({
            companyId,
            userId: readAuth(request)?.user.id,
            action: 'task.review',
            target: taskId,
            payload: { decision: input.decision },
          })

          ctx.events.publish({
            type: 'task.updated',
            companyId,
            payload: {
              conversationId: updated.conversationId,
              taskId,
              status: updated.status,
              revisionCount: updated.revisionCount,
            },
            at: new Date().toISOString(),
          })

          const response: ReviewTaskResponse = {
            task: buildTaskView(repos, companyId, updated),
            decision: input.decision,
          }
          request.json(200, response)
        },
        [taskMembership(repos), requireWork],
      )
    },
  }
}

function taskScope(request: RequestContext): { companyId: string; taskId: string } {
  const tenancy = request.state.tenancy as { companyId?: string } | undefined
  if (!tenancy?.companyId) throw forbidden('Thiếu ngữ cảnh công ty')
  return { companyId: tenancy.companyId, taskId: request.params.taskId! }
}

/** `status=review` hoặc `status=review,done`; giá trị lạ bị bỏ qua thay vì làm hỏng truy vấn. */
function parseStatusFilter(value: string | undefined): TaskStatus[] {
  if (!value) return []
  const allowed: readonly string[] = [
    'draft',
    'assigned',
    'in_progress',
    'blocked',
    'review',
    'done',
    'failed',
    'cancelled',
  ]
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is TaskStatus => allowed.includes(part))
}

function parseLimit(value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 200
  return Math.min(Math.floor(parsed), 500)
}

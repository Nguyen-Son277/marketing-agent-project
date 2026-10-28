/**
 * Cuộc trao đổi với Leader: tạo phiên, gửi tin, lập kế hoạch, chạy kế hoạch, viết
 * báo cáo, và phát sự kiện trực tiếp qua SSE.
 *
 * Vì sao gom cả năm bước vào một module: chúng là một state machine duy nhất —
 * `intake → clarify → brief → plan → assign → execute → review → report`. Tách ra
 * theo endpoint sẽ khiến không ai đọc được toàn bộ vòng đời ở một chỗ, trong khi
 * mọi bước đều sửa cùng một bản ghi `conversations`.
 *
 * Hai quyết định quan trọng:
 *  - `summary`/`review` của `/run` được lưu vào `app_settings` (xem
 *    `services/company-settings.ts`) để `/report` dùng lại; hợp đồng API không có
 *    tham số cho hai giá trị này.
 *  - `/api/conversations/:id` không chứa `companyId`, nên quyền được kiểm bằng
 *    middleware tra ngược `resource-access.ts` (fail closed: 404).
 */
import { conflict, forbidden, notFound, validation, chatAttachmentView, CHAT_ATTACHMENT_MAX_FILES, CHAT_ATTACHMENT_TOTAL_BYTES, parseOrThrow, createConversationSchema, sendMessageSchema, updateConversationSchema } from '@marketing-agent/shared'
import type {
  ConversationDetailResponse,
  ConversationPhase,
  MessageView,
  SendMessageResponse,
} from '@marketing-agent/shared'
import type { AppContext } from '../context.ts'
import { readAuth, requireMembership, requireWork, SESSION_COOKIE } from '../http/middleware.ts'
import type { RequestContext, Router } from '../http/router.ts'
import { orchestratorFor } from '../services/agent-services.ts'
import { readRunState, saveRunState } from '../services/company-settings.ts'
import { conversationMembership } from '../services/resource-access.ts'
import { workflowSnapshot } from '../services/workflow-snapshot.ts'
import { readChatUpload } from '../services/chat-attachments.ts'
import {
  buildTaskViews,
  conversationCost,
  toConversationView,
  toMessageView,
} from '../services/view-mappers.ts'

export function chatRoutes() {
  return {
    name: 'chat',
    register(router: Router, ctx: AppContext): void {
      const repos = ctx.repos

      router.post('/api/conversations/:id/attachments', async (request) => {
        const { companyId, conversationId } = conversationScope(request)
        const userId = readAuth(request)!.user.id
        const file = await readChatUpload(request.req)
        // Recheck access after async document extraction before persisting bytes.
        if (!repos.auth.membership(companyId, userId)) throw notFound('Không tìm thấy cuộc trao đổi')
        repos.chatAttachments.purgePending(companyId)
        const attachment = repos.db.tx(() => {
          const pending = repos.db.get<{ count: number; size: number }>(`SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS size
            FROM chat_attachments WHERE company_id = ? AND conversation_id = ? AND user_id = ? AND message_id IS NULL`, [companyId, conversationId, userId])!
          if (pending.count >= CHAT_ATTACHMENT_MAX_FILES || pending.size + file.bytes.length > CHAT_ATTACHMENT_TOTAL_BYTES) throw validation('Mỗi tin nhắn tối đa 5 tệp, tổng dung lượng 20 MiB. Hãy xoá bớt tệp trước khi thêm.')
          return repos.chatAttachments.create({ companyId, conversationId, userId, ...file })
        })
        request.json(201, { attachment: chatAttachmentView(attachment) })
      }, [conversationMembership(repos), requireWork])

      router.get('/api/conversations/:id/attachments/:attachmentId', (request) => {
        const { companyId, conversationId } = conversationScope(request)
        const file = repos.chatAttachments.find(request.params.attachmentId!, companyId, conversationId)
        if (!file || (!file.messageId && file.userId !== readAuth(request)!.user.id)) throw notFound('Không tìm thấy tệp đính kèm')
        const bytes = repos.chatAttachments.readBytes(file.id, companyId, conversationId)
        const inline = file.mimeType.startsWith('image/')
        request.res.writeHead(200, {
          'Content-Type': inline ? file.mimeType : 'application/octet-stream',
          'Content-Length': bytes.length,
          'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        })
        request.res.end(bytes)
      }, [conversationMembership(repos)])

      router.delete('/api/conversations/:id/attachments/:attachmentId', (request) => {
        const { companyId, conversationId } = conversationScope(request)
        repos.chatAttachments.removePending(request.params.attachmentId!, companyId, conversationId, readAuth(request)!.user.id)
        request.res.writeHead(204); request.res.end()
      }, [conversationMembership(repos), requireWork])

      router.get(
        '/api/companies/:companyId/conversations',
        async (request) => {
          const companyId = request.params.companyId!
          const conversations = repos.work
            .listConversations(companyId, 50)
            .map((conversation) =>
              toConversationView(conversation, conversationCost(repos, companyId, conversation.id)),
            )
          request.json(200, { conversations })
        },
        [requireMembership(repos)],
      )

      router.post(
        '/api/companies/:companyId/conversations',
        async (request) => {
          const companyId = request.params.companyId!
          const input = parseOrThrow(createConversationSchema, await request.body(), 'cuộc trao đổi')
          const userId = readAuth(request)!.user.id
          const conversation = repos.work.createConversation({
            companyId,
            userId,
            title: input.title ?? 'Cuộc trao đổi mới',
            // Ngôn ngữ do client gửi (đã được schema kiểm tra là 'vi' hoặc 'en').
            language: input.language,
          })
          repos.accounting.audit({ companyId, userId, action: 'conversation.create', target: conversation.id })
          request.json(201, { conversation: toConversationView(conversation, 0) })
        },
        [requireMembership(repos), requireWork],
      )

      router.get(
        '/api/conversations/:id',
        async (request) => {
          const { companyId, conversationId } = conversationScope(request)
          const conversation = repos.work.requireConversation(conversationId, companyId)
          const messages = repos.work
            .listMessages(conversationId, companyId, 200)
            .map((message) => toMessageView(message))
          const tasks = buildTaskViews(
            repos,
            companyId,
            repos.work.listTasks(companyId, { conversationId, limit: 200 }),
          )
          const usage = repos.accounting.summaryForConversation(companyId, conversationId)
          const response: ConversationDetailResponse = {
            conversation: toConversationView(conversation, usage.costUsd),
            messages,
            tasks,
            costUsd: usage.costUsd,
            usage: { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, runs: usage.runs },
          }
          request.json(200, response)
        },
        [conversationMembership(repos)],
      )

      router.patch(
        '/api/conversations/:id',
        async (request) => {
          const { companyId, conversationId } = conversationScope(request)
          const input = parseOrThrow(updateConversationSchema, await request.body(), 'cuộc trao đổi')
          const updated = repos.work.updateConversation(conversationId, companyId, { title: input.title })
          repos.accounting.audit({
            companyId,
            userId: readAuth(request)?.user.id,
            action: 'conversation.rename',
            target: conversationId,
            payload: { title: input.title },
          })
          ctx.events.publish({
            type: 'conversation.updated',
            companyId,
            at: new Date().toISOString(),
            payload: { conversationId, id: conversationId, title: updated.title, phase: updated.phase },
          })
          request.json(200, {
            conversation: toConversationView(updated, conversationCost(repos, companyId, conversationId)),
          })
        },
        [conversationMembership(repos), requireWork],
      )

      router.delete(
        '/api/conversations/:id',
        async (request) => {
          const { companyId, conversationId } = conversationScope(request)
          const deleteTasksQuery = request.query('deleteTasks')
          let deleteTasks = deleteTasksQuery === 'true' || deleteTasksQuery === '1'
          if (!deleteTasks && request.req.headers['content-type']?.includes('application/json')) {
            try {
              const body = (await request.body()) as { deleteTasks?: boolean }
              if (body?.deleteTasks) deleteTasks = true
            } catch {
              // query param takes precedence
            }
          }
          const conversation = repos.work.findConversation(conversationId, companyId)
          if (!conversation) throw notFound('Không tìm thấy cuộc trao đổi')

          repos.work.deleteConversation(conversationId, companyId, { deleteTasks })
          repos.accounting.deleteSetting(`run-state:${companyId}:${conversationId}`)
          repos.accounting.audit({
            companyId,
            userId: readAuth(request)?.user.id,
            action: 'conversation.delete',
            target: conversationId,
            payload: { deleteTasks, title: conversation.title },
          })
          ctx.events.publish({
            type: 'conversation.updated',
            companyId,
            at: new Date().toISOString(),
            payload: { conversationId, id: conversationId, deleted: true, deleteTasks },
          })
          request.json(200, { deleted: true, conversationId, deleteTasks })
        },
        [conversationMembership(repos), requireWork],
      )

      router.get(
        '/api/conversations/:id/workflow',
        (request) => {
          const { companyId, conversationId } = conversationScope(request)
          request.json(200, workflowSnapshot(ctx, companyId, conversationId))
        },
        [conversationMembership(repos)],
      )

      router.post(
        '/api/conversations/:id/messages',
        async (request) => {
          const { companyId, conversationId } = conversationScope(request)
          const input = parseOrThrow(sendMessageSchema, await request.body(), 'tin nhắn')
          const userId = readAuth(request)!.user.id
          const orchestrator = await orchestratorFor(ctx, companyId)
          const turn = await orchestrator.sendMessage({
            companyId,
            conversationId,
            userId,
            content: input.content,
            attachmentIds: input.attachmentIds,
            mode: input.mode,
            autoPlan: input.autoPlan,
            // Câu trả lời thẻ chọn đi thẳng xuống orchestrator: nơi đó áp vào brief một
            // cách tất định trước khi BriefGate kiểm tra, nên route không tự đoán.
            answers: (input.answers ?? []).map((answer) => ({
              field: answer.field,
              optionIds: answer.optionIds ?? [],
              ...(answer.custom ? { custom: answer.custom } : {}),
            })),
          })

          const conversation = repos.work.requireConversation(conversationId, companyId)
          const reply = lastAssistantMessage(repos, companyId, conversationId)
          const response: SendMessageResponse = {
            conversation: toConversationView(conversation, conversationCost(repos, companyId, conversationId)),
            reply,
            briefComplete: turn.briefComplete,
            missingFields: turn.missingFields,
            phase: turn.phase as ConversationPhase,
            costUsd: turn.costUsd,
            // Thẻ chọn cho lượt này; `reply.clarify` do view-mappers gắn từ meta.
            ...(turn.clarify ? { clarify: turn.clarify } : {}),
          }
          request.json(200, response)
        },
        [conversationMembership(repos), requireWork],
      )

      router.post(
        '/api/conversations/:id/plan',
        async (request) => {
          const { companyId, conversationId } = conversationScope(request)
          const orchestrator = await orchestratorFor(ctx, companyId)
          const plan = await orchestrator.plan({ companyId, conversationId })
          repos.accounting.audit({
            companyId,
            userId: readAuth(request)?.user.id,
            action: 'conversation.plan',
            target: conversationId,
            payload: { tasks: plan.tasks.length },
          })
          request.json(200, plan)
        },
        [conversationMembership(repos), requireWork],
      )

      router.post(
        '/api/conversations/:id/run',
        async (request) => {
          const { companyId, conversationId } = conversationScope(request)
          const orchestrator = await orchestratorFor(ctx, companyId)
          const result = await orchestrator.runPlan({ companyId, conversationId, actorUserId: readAuth(request)?.user.id })
          saveRunState(ctx.repos, companyId, conversationId, result)
          repos.accounting.audit({
            companyId,
            userId: readAuth(request)?.user.id,
            action: 'conversation.run',
            target: conversationId,
            payload: { completed: result.summary.completed, failed: result.summary.failed },
          })
          request.json(200, result)
        },
        [conversationMembership(repos), requireWork],
      )

      router.post(
        '/api/conversations/:id/report',
        async (request) => {
          const { companyId, conversationId } = conversationScope(request)
          const state = readRunState(repos, companyId, conversationId)
          if (!state) {
            throw conflict('Chưa có kết quả chạy để lập báo cáo. Hãy chạy kế hoạch trước.')
          }
          const orchestrator = await orchestratorFor(ctx, companyId)
          const report = await orchestrator.report({
            companyId,
            conversationId,
            summary: state.summary,
            review: state.review,
          })
          repos.accounting.audit({
            companyId,
            userId: readAuth(request)?.user.id,
            action: 'conversation.report',
            target: conversationId,
            payload: { artifactId: report.artifactId },
          })
          request.json(200, report)
        },
        [conversationMembership(repos), requireWork],
      )

      router.get(
        '/api/conversations/:id/stream',
        async (request) => {
          const { companyId, conversationId } = conversationScope(request)
          streamConversation(ctx, request, companyId, conversationId)
        },
        [conversationMembership(repos)],
      )
    },
  }
}

interface ConversationScope {
  readonly companyId: string
  readonly conversationId: string
}

/** `ctx.state.tenancy` đã được `conversationMembership` xác thực trước handler. */
function conversationScope(request: RequestContext): ConversationScope {
  const tenancy = request.state.tenancy as { companyId?: string } | undefined
  if (!tenancy?.companyId) throw forbidden('Thiếu ngữ cảnh công ty')
  return { companyId: tenancy.companyId, conversationId: request.params.id! }
}

/** Tin nhắn cuối cùng của Leader trong phiên; luôn có sau `sendMessage`. */
function lastAssistantMessage(
  repos: AppContext['repos'],
  companyId: string,
  conversationId: string,
): MessageView {
  const messages = repos.work.listMessages(conversationId, companyId, 200)
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message && message.role === 'assistant') return toMessageView(message)
  }
  const last = messages[messages.length - 1]
  if (last) return toMessageView(last)
  throw conflict('Không tìm thấy câu trả lời của Leader')
}

/**
 * Mở luồng SSE cho một phiên.
 *
 * Sự kiện được phát theo công ty (bus chỉ có khoá theo công ty), nên sự kiện mang
 * `conversationId` của phiên khác bị bỏ qua. Nhịp tim 25 giây giữ kết nối sống qua
 * proxy; `onClose` gỡ cả nhịp tim lẫn đăng ký để không rò rỉ listener.
 */
function streamConversation(
  ctx: AppContext,
  request: RequestContext,
  companyId: string,
  conversationId: string,
): void {
  const writer = request.sse()
  // These are best-effort in-process hints only. Reconnects must reconcile GET /workflow;
  // the timestamp header is not a lossless Last-Event-ID replay cursor.
  const since =
    request.query('since') ?? (typeof request.req.headers['last-event-id'] === 'string' ? request.req.headers['last-event-id'] : undefined)

  for (const past of ctx.events.since(companyId, since)) {
    if (eventMatchesConversation(ctx, past.payload, companyId, conversationId)) writer.send(past.type, past)
  }

  const unsubscribe = ctx.events.subscribe(companyId, (event) => {
    if (!eventMatchesConversation(ctx, event.payload, companyId, conversationId)) return
    if (!streamAccessStillValid(ctx, request, companyId, conversationId)) {
      writer.end()
      return
    }
    writer.send(event.type, event)
  })
  const heartbeat = setInterval(() => {
    if (writer.closed) return
    if (!streamAccessStillValid(ctx, request, companyId, conversationId)) {
      writer.end()
      return
    }
    writer.comment(`heartbeat ${new Date().toISOString()}`)
  }, 25_000)
  heartbeat.unref?.()

  writer.onClose(() => {
    clearInterval(heartbeat)
    unsubscribe()
  })
}

/** Producer conversation scope wins; old task-only events resolve within the company. */
export function eventMatchesConversation(
  ctx: AppContext,
  payload: unknown,
  companyId: string,
  conversationId: string,
): boolean {
  if (!payload || typeof payload !== 'object') return false
  const value = payload as Record<string, unknown>
  if (value.companyId !== undefined && value.companyId !== companyId) return false
  if (typeof value.conversationId === 'string') return value.conversationId === conversationId
  if (value.conversationId !== undefined && value.conversationId !== null) return false
  if (typeof value.taskId !== 'string' || !value.taskId) return false
  return ctx.repos.work.findTask(value.taskId, companyId)?.conversationId === conversationId
}

/** Re-read session/user/member/account restrictions instead of trusting the opening request. */
export function streamAccessStillValid(
  ctx: AppContext,
  request: RequestContext,
  companyId: string,
  conversationId: string,
): boolean {
  try {
    const auth = readAuth(request)
    const token = request.cookies()[SESSION_COOKIE]
    if (!auth || !token) return false
    const resolved = ctx.repos.auth.resolveSession(token)
    if (!resolved || resolved.sessionId !== auth.sessionId || resolved.user.id !== auth.user.id) return false
    const user = resolved.user
    if (user.approvalStatus !== 'approved' || user.mustChangePassword || user.accountType === 'employee' || user.isAdmin) return false
    return !!ctx.repos.auth.membership(companyId, user.id) &&
      !!ctx.repos.work.findConversation(conversationId, companyId)
  } catch {
    // Fail closed without publishing session tokens or raw auth/repository errors.
    return false
  }
}

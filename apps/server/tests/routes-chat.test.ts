/**
 * Test module trao đổi (không dùng LLM).
 *
 * Luồng brief chưa đủ là happy path rẻ nhất và không cần model: Leader hỏi lại đúng
 * trường còn thiếu. Đây cũng là chỗ dễ hở quyền nhất vì các đường dẫn không chứa
 * `companyId`; test khẳng định người công ty khác nhận 404.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addMember, createRoutesTestContext, errorCode, tenant, type RoutesTestContext } from './helpers/routes-helpers.ts'

let ctx: RoutesTestContext

beforeEach(async () => {
  ctx = await createRoutesTestContext()
})

afterEach(async () => {
  await ctx.close()
})

async function newConversation(cookie: Record<string, string>, companyId: string): Promise<string> {
  const response = await ctx.client.request('POST', `/api/companies/${companyId}/conversations`, {
    headers: cookie,
    body: { title: 'Chiến dịch tháng 11' },
  })
  expect(response.status).toBe(201)
  return response.json<{ conversation: { id: string } }>().conversation.id
}

describe('chat routes', () => {
  it('tạo phiên, gửi tin và hỏi lại khi brief còn thiếu (happy path)', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'chat-owner@example.com', 'Chat Co')
    const conversationId = await newConversation(ownerCookie, company.id)

    const list = await ctx.client.request('GET', `/api/companies/${company.id}/conversations`, {
      headers: ownerCookie,
    })
    expect(list.status).toBe(200)
    expect(list.json<{ conversations: unknown[] }>().conversations).toHaveLength(1)

    const message = await ctx.client.request('POST', `/api/conversations/${conversationId}/messages`, {
      headers: ownerCookie,
      body: { content: 'Tôi muốn làm marketing cho sản phẩm mới' },
    })
    expect(message.status).toBe(200)
    const body = message.json<{
      briefComplete: boolean
      missingFields: string[]
      phase: string
      reply: { contentMd: string; authorKind: string }
    }>()
    expect(body.briefComplete).toBe(false)
    expect(body.missingFields.length).toBeGreaterThan(0)
    expect(body.phase).toBe('clarify')
    expect(body.reply.contentMd).toContain('Mục tiêu')

    const detail = await ctx.client.request('GET', `/api/conversations/${conversationId}`, {
      headers: ownerCookie,
    })
    expect(detail.status).toBe(200)
    const detailBody = detail.json<{ messages: unknown[]; conversation: { id: string }; usage: { runs: number } }>()
    expect(detailBody.conversation.id).toBe(conversationId)
    expect(detailBody.messages.length).toBe(2)
  })

  it('trả 400 kèm error.code=validation khi nội dung tin nhắn rỗng', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'chat-invalid@example.com', 'Chat Invalid')
    const conversationId = await newConversation(ownerCookie, company.id)
    const response = await ctx.client.request('POST', `/api/conversations/${conversationId}/messages`, {
      headers: ownerCookie,
      body: { content: '   ' },
    })
    expect(response.status).toBe(400)
    expect(errorCode(response)).toBe('validation')
  })

  it('từ chối chạy khi chưa có kế hoạch và báo cáo khi chưa chạy', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'chat-state@example.com', 'Chat State')
    const conversationId = await newConversation(ownerCookie, company.id)

    const run = await ctx.client.request('POST', `/api/conversations/${conversationId}/run`, {
      headers: ownerCookie,
      body: {},
    })
    expect(run.status).toBe(409)
    expect(errorCode(run)).toBe('conflict')

    const report = await ctx.client.request('POST', `/api/conversations/${conversationId}/report`, {
      headers: ownerCookie,
      body: {},
    })
    expect(report.status).toBe(409)
    expect(errorCode(report)).toBe('conflict')
  })

  it('viewer KHÔNG gửi được tin nhắn', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'chat-owner2@example.com', 'Chat Viewer')
    const viewer = await addMember(ctx, company.id, 'chat-viewer@example.com', 'viewer')
    const conversationId = await newConversation(ownerCookie, company.id)
    const response = await ctx.client.request('POST', `/api/conversations/${conversationId}/messages`, {
      headers: viewer.cookie,
      body: { content: 'viewer thử gửi' },
    })
    expect(response.status).toBe(403)
  })

  it('cô lập tenant: công ty B nhận 404 cho cuộc trao đổi của công ty A', async () => {
    const a = await tenant(ctx, 'chat-a@example.com', 'Chat A')
    const b = await tenant(ctx, 'chat-b@example.com', 'Chat B')
    const conversationId = await newConversation(a.ownerCookie, a.company.id)

    const read = await ctx.client.request('GET', `/api/conversations/${conversationId}`, {
      headers: b.ownerCookie,
    })
    expect(read.status).toBe(404)

    const write = await ctx.client.request('POST', `/api/conversations/${conversationId}/messages`, {
      headers: b.ownerCookie,
      body: { content: 'B gửi vào phiên của A' },
    })
    expect(write.status).toBe(404)

    const plan = await ctx.client.request('POST', `/api/conversations/${conversationId}/plan`, {
      headers: b.ownerCookie,
      body: {},
    })
    expect(plan.status).toBe(404)
  })

  it('phát sự kiện SSE của đúng phiên', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'chat-sse@example.com', 'Chat SSE')
    const conversationId = await newConversation(ownerCookie, company.id)

    const controller = new AbortController()
    const response = await fetch(`${ctx.client.baseUrl}/api/conversations/${conversationId}/stream`, {
      headers: ownerCookie,
      signal: controller.signal,
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const reader = response.body!.getReader()
    ctx.app.context.events.publish({
      type: 'warning',
      companyId: company.id,
      payload: { conversationId, message: 'thử SSE' },
      at: new Date().toISOString(),
    })

    let received = ''
    const deadline = Date.now() + 3_000
    while (Date.now() < deadline && !received.includes('event: warning')) {
      const chunk = await reader.read()
      if (chunk.done) break
      received += new TextDecoder().decode(chunk.value)
    }
    controller.abort()
    expect(received).toContain('event: warning')
  })

  it('sửa tên cuộc trao đổi (PATCH) và cô lập quyền', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'chat-rename@example.com', 'Chat Rename')
    const other = await tenant(ctx, 'chat-other@example.com', 'Chat Other')
    const viewer = await addMember(ctx, company.id, 'chat-rename-viewer@example.com', 'viewer')
    const conversationId = await newConversation(ownerCookie, company.id)

    // Đổi tên thành công
    const patchRes = await ctx.client.request('PATCH', `/api/conversations/${conversationId}`, {
      headers: ownerCookie,
      body: { title: 'Tên mới đã cập nhật' },
    })
    expect(patchRes.status).toBe(200)
    expect(patchRes.json<{ conversation: { title: string } }>().conversation.title).toBe('Tên mới đã cập nhật')

    // Lấy lại chi tiết kiểm tra tên mới
    const detail = await ctx.client.request('GET', `/api/conversations/${conversationId}`, {
      headers: ownerCookie,
    })
    expect(detail.json<{ conversation: { title: string } }>().conversation.title).toBe('Tên mới đã cập nhật')

    // Tên rỗng bị từ chối
    const invalidRes = await ctx.client.request('PATCH', `/api/conversations/${conversationId}`, {
      headers: ownerCookie,
      body: { title: '   ' },
    })
    expect(invalidRes.status).toBe(400)
    expect(errorCode(invalidRes)).toBe('validation')

    // Viewer không được sửa tên
    const viewerRes = await ctx.client.request('PATCH', `/api/conversations/${conversationId}`, {
      headers: viewer.cookie,
      body: { title: 'Viewer thử sửa' },
    })
    expect(viewerRes.status).toBe(403)

    // Công ty khác nhận 404
    const otherRes = await ctx.client.request('PATCH', `/api/conversations/${conversationId}`, {
      headers: other.ownerCookie,
      body: { title: 'Hacker sửa' },
    })
    expect(otherRes.status).toBe(404)
  })

  it('xoá cuộc trao đổi (DELETE) giữ lại công việc khi deleteTasks=false', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'chat-del-keep@example.com', 'Chat Del Keep')
    const conversationId = await newConversation(ownerCookie, company.id)

    // Tạo một task thuộc cuộc trao đổi này
    const task = ctx.repos.work.createTask({
      companyId: company.id,
      conversationId,
      title: 'Việc cần giữ lại',
      briefMd: 'Brief',
    })

    const delRes = await ctx.client.request('DELETE', `/api/conversations/${conversationId}?deleteTasks=false`, {
      headers: ownerCookie,
    })
    expect(delRes.status).toBe(200)
    expect(delRes.json<{ deleted: boolean; deleteTasks: boolean }>().deleted).toBe(true)
    expect(delRes.json<{ deleted: boolean; deleteTasks: boolean }>().deleteTasks).toBe(false)

    // Cuộc trao đổi đã bị xoá
    const detailRes = await ctx.client.request('GET', `/api/conversations/${conversationId}`, {
      headers: ownerCookie,
    })
    expect(detailRes.status).toBe(404)

    // Task vẫn còn nhưng conversation_id chuyển thành null
    const preservedTask = ctx.repos.work.findTask(task.id, company.id)
    expect(preservedTask).toBeDefined()
    expect(preservedTask?.conversationId).toBeNull()
  })

  it('xoá cuộc trao đổi (DELETE) kèm công việc khi deleteTasks=true', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'chat-del-all@example.com', 'Chat Del All')
    const other = await tenant(ctx, 'chat-del-other@example.com', 'Chat Del Other')
    const viewer = await addMember(ctx, company.id, 'chat-del-viewer@example.com', 'viewer')
    const conversationId = await newConversation(ownerCookie, company.id)

    // Tạo một task thuộc cuộc trao đổi này
    const task = ctx.repos.work.createTask({
      companyId: company.id,
      conversationId,
      title: 'Việc cần xoá theo',
      briefMd: 'Brief',
    })

    // Viewer không được xoá
    const viewerRes = await ctx.client.request('DELETE', `/api/conversations/${conversationId}`, {
      headers: viewer.cookie,
    })
    expect(viewerRes.status).toBe(403)

    // Công ty khác nhận 404
    const otherRes = await ctx.client.request('DELETE', `/api/conversations/${conversationId}`, {
      headers: other.ownerCookie,
    })
    expect(otherRes.status).toBe(404)

    // Xoá kèm task
    const delRes = await ctx.client.request('DELETE', `/api/conversations/${conversationId}?deleteTasks=true`, {
      headers: ownerCookie,
    })
    expect(delRes.status).toBe(200)

    // Cả cuộc trao đổi lẫn task đều bị xoá
    expect(ctx.repos.work.findConversation(conversationId, company.id)).toBeUndefined()
    expect(ctx.repos.work.findTask(task.id, company.id)).toBeUndefined()
  })

  it('tự động đặt tên cuộc trò chuyện theo nội dung tin nhắn đầu khi tiêu đề mặc định', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'chat-autotitle@example.com', 'Chat AutoTitle')
    // Tạo cuộc trò chuyện với tiêu đề mặc định
    const createRes = await ctx.client.request('POST', `/api/companies/${company.id}/conversations`, {
      headers: ownerCookie,
      body: { title: 'Cuộc trao đổi mới' },
    })
    const conversationId = createRes.json<{ conversation: { id: string } }>().conversation.id

    // Gửi tin nhắn đầu tiên
    await ctx.client.request('POST', `/api/conversations/${conversationId}/messages`, {
      headers: ownerCookie,
      body: { content: 'Lập kế hoạch content tháng 12 cho sản phẩm Sapa POS, mục tiêu 100 lead' },
    })

    // Kiểm tra tên cuộc trò chuyện đã tự động cập nhật
    const detail = await ctx.client.request('GET', `/api/conversations/${conversationId}`, {
      headers: ownerCookie,
    })
    const title = detail.json<{ conversation: { title: string } }>().conversation.title
    expect(title).not.toBe('Cuộc trao đổi mới')
    expect(title).toContain('Lập kế hoạch content tháng 12')
  })
})

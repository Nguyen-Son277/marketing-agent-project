/**
 * Test module công việc.
 *
 * Đây là nhóm route dễ hở nhất vì `/api/tasks/:taskId` không chứa `companyId`:
 * test kiểm tra đúng hàng rào tra ngược — người công ty khác nhận 404 chứ không
 * phải đọc được công việc.
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

describe('task routes', () => {
  it('liệt kê công việc kèm số đếm và trả chi tiết (happy path)', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'task-owner@example.com', 'Task Co')
    const def = ctx.repos.team.findAgentDefByRole('content-writer')!
    const task = ctx.repos.work.createTask({
      companyId: company.id,
      title: 'Viết 5 bài SEO',
      briefMd: 'Viết 5 bài chuẩn SEO cho từ khoá chính.',
      assigneeAgentDefId: def.id,
      status: 'review',
    })
    ctx.repos.work.addArtifact({
      companyId: company.id,
      taskId: task.id,
      name: 'Bản nháp',
      kind: 'markdown',
      content: '# Bản nháp',
    })

    const list = await ctx.client.request('GET', `/api/companies/${company.id}/tasks`, {
      headers: ownerCookie,
    })
    expect(list.status).toBe(200)
    const body = list.json<{
      tasks: { id: string; assigneeRole: string | null; artifactIds: string[] }[]
      counts: Record<string, number>
    }>()
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0]?.assigneeRole).toBe('content-writer')
    expect(body.tasks[0]?.artifactIds).toHaveLength(1)
    expect(body.counts['review']).toBe(1)
    expect(body.counts['done']).toBe(0)

    const detail = await ctx.client.request('GET', `/api/tasks/${task.id}`, { headers: ownerCookie })
    expect(detail.status).toBe(200)
    const detailBody = detail.json<{ task: { id: string }; artifacts: unknown[]; events: unknown[] }>()
    expect(detailBody.task.id).toBe(task.id)
    expect(detailBody.artifacts).toHaveLength(1)
  })

  it('owner duyệt công việc đang chờ review', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'task-review@example.com', 'Task Review')
    const def = ctx.repos.team.findAgentDefByRole('analytics')!
    const task = ctx.repos.work.createTask({
      companyId: company.id,
      title: 'Báo cáo tuần',
      briefMd: 'Tổng hợp chỉ số tuần này.',
      assigneeAgentDefId: def.id,
      status: 'review',
    })
    const response = await ctx.client.request('POST', `/api/tasks/${task.id}/review`, {
      headers: ownerCookie,
      body: { decision: 'approve', note: 'Đạt yêu cầu' },
    })
    expect(response.status).toBe(200)
    const body = response.json<{ task: { status: string }; decision: string }>()
    expect(body.decision).toBe('approve')
    expect(body.task.status).toBe('done')
  })

  it('trả 400 kèm error.code=validation khi quyết định không hợp lệ', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'task-invalid@example.com', 'Task Invalid')
    const def = ctx.repos.team.findAgentDefByRole('analytics')!
    const task = ctx.repos.work.createTask({
      companyId: company.id,
      title: 'Việc hợp lệ',
      briefMd: 'Mô tả đủ dài cho công việc này.',
      assigneeAgentDefId: def.id,
      status: 'review',
    })
    const response = await ctx.client.request('POST', `/api/tasks/${task.id}/review`, {
      headers: ownerCookie,
      body: { decision: 'khong-hop-le' },
    })
    expect(response.status).toBe(400)
    expect(errorCode(response)).toBe('validation')
  })

  it('viewer KHÔNG duyệt được công việc', async () => {
    const { company } = await tenant(ctx, 'task-owner2@example.com', 'Task Viewer')
    const viewer = await addMember(ctx, company.id, 'task-viewer@example.com', 'viewer')
    const def = ctx.repos.team.findAgentDefByRole('analytics')!
    const task = ctx.repos.work.createTask({
      companyId: company.id,
      title: 'Việc chờ duyệt',
      briefMd: 'Mô tả đủ dài cho công việc này.',
      assigneeAgentDefId: def.id,
      status: 'review',
    })
    const response = await ctx.client.request('POST', `/api/tasks/${task.id}/review`, {
      headers: viewer.cookie,
      body: { decision: 'approve' },
    })
    expect(response.status).toBe(403)
    // Đọc thì viewer vẫn được phép.
    const read = await ctx.client.request('GET', `/api/tasks/${task.id}`, { headers: viewer.cookie })
    expect(read.status).toBe(200)
  })

  it('cô lập tenant: công ty B nhận 404 cho công việc của công ty A', async () => {
    const a = await tenant(ctx, 'task-a@example.com', 'Task A')
    const b = await tenant(ctx, 'task-b@example.com', 'Task B')
    const def = ctx.repos.team.findAgentDefByRole('analytics')!
    const task = ctx.repos.work.createTask({
      companyId: a.company.id,
      title: 'Việc riêng của A',
      briefMd: 'Mô tả đủ dài cho công việc này.',
      assigneeAgentDefId: def.id,
      status: 'review',
    })

    const read = await ctx.client.request('GET', `/api/tasks/${task.id}`, { headers: b.ownerCookie })
    expect([403, 404]).toContain(read.status)

    const review = await ctx.client.request('POST', `/api/tasks/${task.id}/review`, {
      headers: b.ownerCookie,
      body: { decision: 'cancel' },
    })
    expect([403, 404]).toContain(review.status)
    // Trạng thái của A không đổi.
    expect(ctx.repos.work.requireTask(task.id, a.company.id).status).toBe('review')
  })
})

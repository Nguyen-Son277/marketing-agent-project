import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatAttachmentView, ConversationDetailResponse } from '@marketing-agent/shared'
import { AppError } from '@marketing-agent/shared'
import { createRoutesTestContext, tenant, addMember, configureCompanyModel, type RoutesTestContext } from './helpers/routes-helpers.ts'
import { setAgentRuntimeOverrides } from '../src/services/agent-services.ts'
import { scriptedAdapter, textTurn } from '../../../packages/agent-runtime/tests/fixtures.ts'
import { toOpenAiMessages } from '../../../packages/llm/src/adapters/openai-compatible.ts'
import { toAnthropicMessages } from '../../../packages/llm/src/adapters/anthropic.ts'

let ctx: RoutesTestContext
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64')
beforeEach(async () => { ctx = await createRoutesTestContext() })
afterEach(async () => { await ctx.close() })

async function setup(email = 'attachments@example.com', name = 'Attachments') {
  const owner = await tenant(ctx, email, name)
  const user = ctx.repos.auth.findUserByEmail(email)!
  const conversation = ctx.repos.work.createConversation({ companyId: owner.company.id, userId: user.id, title: 'File analysis' })
  return { ...owner, conversation, user }
}

async function upload(conversationId: string, cookie: Record<string, string>, filename: string, bytes: Buffer = Buffer.from('Revenue: 125 million VND. Region: Hanoi.')) {
  const form = new FormData()
  // The server must infer the actual type rather than trusting this MIME header.
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }), filename)
  return fetch(`${ctx.client.baseUrl}/api/conversations/${conversationId}/attachments`, { method: 'POST', headers: cookie, body: form })
}

async function attach(conversationId: string, cookie: Record<string, string>, filename = 'report.txt', bytes?: Buffer): Promise<ChatAttachmentView> {
  const response = await upload(conversationId, cookie, filename, bytes)
  expect(response.status).toBe(201)
  return (await response.json() as { attachment: ChatAttachmentView }).attachment
}

describe('Leader chat attachments through HTTP and runtime', () => {
  it('reads actual text, accepts an attachment-only turn, meters analysis and restores original files in history', async () => {
    const owner = await setup()
    configureCompanyModel(ctx, owner.company.id)
    const adapter = scriptedAdapter([textTurn('report.txt: Revenue is 125 million VND in Hanoi.')])
    setAgentRuntimeOverrides(ctx.repos, { adapter })
    const file = await attach(owner.conversation.id, owner.ownerCookie)
    const response = await ctx.client.request('POST', `/api/conversations/${owner.conversation.id}/messages`, {
      headers: owner.ownerCookie, body: { content: '', attachmentIds: [file.id] },
    })
    expect(response.status).toBe(200)
    expect(response.body).toContain('125 million')
    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]!.messages.find((message) => message.role === 'user')!.content).toContain('Revenue: 125 million VND. Region: Hanoi.')
    expect(adapter.requests[0]!.tools ?? []).toHaveLength(0)
    expect(ctx.repos.work.listTasks(owner.company.id)).toHaveLength(0)
    const detail = await ctx.client.request('GET', `/api/conversations/${owner.conversation.id}`, { headers: owner.ownerCookie })
    const history = detail.json<ConversationDetailResponse>()
    expect(history.messages[0]!.attachments).toEqual([file])
    expect(history.messages[1]!.contentMd).toContain('125 million')
    expect(history.usage.runs).toBe(1)
    expect(history.usage.tokensIn).toBeGreaterThan(0)
    const original = await fetch(ctx.client.baseUrl + file.url, { headers: owner.ownerCookie })
    expect(original.status).toBe(200)
    expect(original.headers.get('content-disposition')).toContain('attachment;')
    expect(await original.text()).toContain('Revenue: 125 million')
    const replay = await ctx.client.request('POST', `/api/conversations/${owner.conversation.id}/messages`, { headers: owner.ownerCookie, body: { content: 'again', attachmentIds: [file.id] } })
    expect(replay.status).toBe(404)
    expect(adapter.requests).toHaveLength(1)
  })

  it('delivers real image bytes as vision content to both provider formats', async () => {
    const owner = await setup()
    const { modelPk } = configureCompanyModel(ctx, owner.company.id)
    ctx.repos.llm.updateModel(modelPk, { supportsVision: true })
    const adapter = scriptedAdapter([textTurn('The image has one pixel.')])
    setAgentRuntimeOverrides(ctx.repos, { adapter })
    const file = await attach(owner.conversation.id, owner.ownerCookie, 'ảnh.png', png)
    expect(file.mimeType).toBe('image/png')
    const response = await ctx.client.request('POST', `/api/conversations/${owner.conversation.id}/messages`, { headers: owner.ownerCookie, body: { content: 'Read this image', attachmentIds: [file.id] } })
    expect(response.status).toBe(200)
    const messages = adapter.requests[0]!.messages
    expect(messages.find((message) => message.role === 'user')!.images).toEqual([{ mimeType: 'image/png', data: png.toString('base64') }])
    const openAi = toOpenAiMessages(messages).find((message) => message.role === 'user')!
    expect(openAi.content).toContainEqual({ type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } })
    const anthropic = toAnthropicMessages(messages).messages.find((message) => message.role === 'user')!
    expect(anthropic.content).toContainEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } })
    const original = await fetch(ctx.client.baseUrl + file.url, { headers: owner.ownerCookie })
    expect(original.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await original.arrayBuffer())).toEqual(png)
  })

  it('keeps uploads retryable when vision is not configured, without pretending to read an image', async () => {
    const owner = await setup()
    const { modelPk } = configureCompanyModel(ctx, owner.company.id)
    const adapter = scriptedAdapter([textTurn('Image analysis')])
    setAgentRuntimeOverrides(ctx.repos, { adapter })
    const file = await attach(owner.conversation.id, owner.ownerCookie, 'image.png', png)
    const send = () => ctx.client.request('POST', `/api/conversations/${owner.conversation.id}/messages`, { headers: owner.ownerCookie, body: { attachmentIds: [file.id] } })
    const response = await send()
    expect(response.status).toBe(424)
    expect(response.body).toContain('vision')
    expect(adapter.requests).toHaveLength(0)
    expect(ctx.repos.work.listMessages(owner.conversation.id, owner.company.id)).toHaveLength(0)
    ctx.repos.llm.updateModel(modelPk, { supportsVision: true })
    expect((await send()).status).toBe(200)
    expect(ctx.repos.work.listMessages(owner.conversation.id, owner.company.id)).toHaveLength(2)
  })

  it('retains pending files after a provider error so a retry does not duplicate user messages', async () => {
    const owner = await setup()
    configureCompanyModel(ctx, owner.company.id)
    setAgentRuntimeOverrides(ctx.repos, { adapter: scriptedAdapter([{ error: new AppError('provider_error', 'Temporary gateway failure') }]) })
    const file = await attach(owner.conversation.id, owner.ownerCookie)
    const send = () => ctx.client.request('POST', `/api/conversations/${owner.conversation.id}/messages`, { headers: owner.ownerCookie, body: { content: 'Analyze', attachmentIds: [file.id] } })
    expect((await send()).status).not.toBe(200)
    expect(ctx.repos.work.listMessages(owner.conversation.id, owner.company.id)).toHaveLength(0)
    expect(ctx.repos.chatAttachments.find(file.id, owner.company.id, owner.conversation.id)!.messageId).toBeNull()
    setAgentRuntimeOverrides(ctx.repos, { adapter: scriptedAdapter([textTurn('Analysis after retry')]) })
    expect((await send()).status).toBe(200)
    expect(ctx.repos.work.listMessages(owner.conversation.id, owner.company.id)).toHaveLength(2)
  })

  it('enforces tenant, conversation, uploader and viewer access at upload, read and send', async () => {
    const a = await setup('a@example.com', 'A')
    const b = await setup('b@example.com', 'B')
    const viewer = await addMember(ctx, a.company.id, 'viewer@example.com', 'viewer')
    const member = await addMember(ctx, a.company.id, 'member@example.com', 'member')
    const file = await attach(a.conversation.id, a.ownerCookie)
    expect((await fetch(ctx.client.baseUrl + file.url)).status).toBe(401)
    expect((await fetch(ctx.client.baseUrl + file.url, { headers: b.ownerCookie })).status).toBe(404)
    expect((await fetch(ctx.client.baseUrl + file.url, { headers: member.cookie })).status).toBe(404)
    expect((await upload(a.conversation.id, b.ownerCookie, 'x.txt')).status).toBe(404)
    expect((await upload(a.conversation.id, viewer.cookie, 'x.txt')).status).toBe(403)
    const other = ctx.repos.work.createConversation({ companyId: a.company.id, userId: a.user.id, title: 'Other' })
    for (const [id, cookie] of [[b.conversation.id, b.ownerCookie], [other.id, a.ownerCookie], [a.conversation.id, member.cookie]] as const) {
      const response = await ctx.client.request('POST', `/api/conversations/${id}/messages`, { headers: cookie, body: { content: 'Read', attachmentIds: [file.id] } })
      expect(response.status).toBe(404)
    }
    expect((await ctx.client.request('DELETE', file.url, { headers: a.ownerCookie })).status).toBe(204)
    expect((await fetch(ctx.client.baseUrl + file.url, { headers: a.ownerCookie })).status).toBe(404)
  })

  it('rejects unsupported, spoofed, oversized-text and excess uploads without storing them', async () => {
    const owner = await setup()
    for (const [name, bytes] of [['fake.png', Buffer.from('not image')], ['image.svg', Buffer.from('<svg/>')], ['long.txt', Buffer.alloc(40_001, 65)], ['empty.txt', Buffer.alloc(0)]] as const) {
      expect((await upload(owner.conversation.id, owner.ownerCookie, name, bytes)).status).toBe(400)
    }
    expect(ctx.repos.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM chat_attachments')!.n).toBe(0)
    for (let i = 0; i < 5; i++) await attach(owner.conversation.id, owner.ownerCookie, `file-${i}.txt`)
    expect((await upload(owner.conversation.id, owner.ownerCookie, 'sixth.txt')).status).toBe(400)
    expect(ctx.repos.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM chat_attachments')!.n).toBe(5)
  })
})

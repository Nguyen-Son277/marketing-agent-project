import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { SocialBrowserService, createSocialBrowserTools, browserAssetPath } from '@marketing-agent/tools'
import { readFile } from 'node:fs/promises'
import { recoverBrowserJobs, stopBrowserJobs } from '../src/services/browser-job-runner.ts'
import {
  addMember,
  createRoutesTestContext,
  tenant,
  type RoutesTestContext,
} from './helpers/routes-helpers.ts'

let ctx: RoutesTestContext,
  worker: Server,
  endpoint: string,
  base: string,
  cookie: Record<string, string>,
  companyId: string,
  actorId: string
let calls: { path: string; body: unknown }[], verified: boolean, needsHuman: boolean
let modelFixture=false
let agentGate:{entered:()=>void;wait:Promise<void>}|undefined
const TOKEN = 'test-browser-worker-secret-never-return-to-agent-0123456789'
beforeEach(async () => {
  calls = []
  verified = true
  needsHuman = false
  modelFixture=false;agentGate=undefined
  worker = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401)
      res.end('{}')
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString(),
      body = raw ? JSON.parse(raw) : null
    calls.push({ path: req.url!, body })
    if(modelFixture&&req.url==='/v1/chat/completions'){
      const task=JSON.parse(body.messages.find((m:{role:string})=>m.role==='user').content)
      const done=body.messages.filter((m:{role:string})=>m.role==='tool').length
      const args=done===0?{jobId:task.job.id,operation:'start'}:{jobId:task.job.id,operation:'finish',resultUrl:'https://social.example/posts/verified',result:'Published via browser'}
      const delta=done<2?{tool_calls:[{index:0,id:`call-${done}`,type:'function',function:{name:'browser_step',arguments:JSON.stringify(args)}}]}:{content:'Completed and verified'}
      res.writeHead(200,{'Content-Type':'text/event-stream'})
      res.end(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:done<2?'tool_calls':'stop'}],usage:{prompt_tokens:30,completion_tokens:20}})}\n\ndata: [DONE]\n\n`)
      return
    }
    if(req.url==='/agent'&&body.operation==='click'&&agentGate){agentGate.entered();await agentGate.wait}
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify(
        req.url === '/agent' ? { snapshot: 'Fixture website', verified, needsHuman } : { status: 'ready' },
      ),
    )
  })
  await new Promise<void>((resolve) => worker.listen(0, '127.0.0.1', resolve))
  const addr = worker.address()
  endpoint = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  vi.stubEnv('BROWSER_WORKER_ALLOWED_ORIGINS', endpoint)
  ctx = await createRoutesTestContext()
  const a = await tenant(ctx, 'browser-owner@example.com', 'Browser Co')
  companyId = a.company.id
  cookie = a.ownerCookie
  actorId = ctx.repos.auth.findUserByEmail('browser-owner@example.com')!.id
  base = `/api/companies/${companyId}/social-browser`
})
afterEach(async () => {
  await stopBrowserJobs(ctx.app.context)
  await ctx.close()
  await new Promise<void>((resolve) => worker.close(() => resolve()))
  vi.unstubAllEnvs()
})
async function setup() {
  const d = await ctx.client.request('POST', `${base}/desktops`, {
    headers: cookie,
    body: { name: 'US browser', endpoint, region: 'US', token: TOKEN },
  })
  expect(d.status).toBe(201)
  const desktopId = d.json<{ desktop: { id: string } }>().desktop.id
  const c = await ctx.client.request('POST', `${base}/channels`, {
    headers: cookie,
    body: {
      desktopId,
      name: 'Example page',
      platform: 'other',
      entryUrl: 'https://social.example/new',
      allowedHosts: ['social.example'],
      instructions: 'Check account Example before posting',
      canPost: true,
    },
  })
  expect(c.status).toBe(201)
  const channelId = c.json<{ channel: { id: string } }>().channel.id
  const content = ctx.repos.socialBrowser.saveContent(companyId, {
    title: 'Demo post',
    body: 'An actual post from the content library',
  })
  const service = new SocialBrowserService(ctx.repos, ctx.companiesRoot)
  return { desktopId, channelId, contentId: content.id, service }
}
function createJob(
  channelId: string,
  contentId?: string,
  key = 'one-job',
  kind: 'publish' | 'read' = 'publish',
) {
  return ctx.repos.socialBrowser.createJob(companyId, actorId, {
    channelId,
    contentId,
    kind,
    idempotencyKey: key,
    instructions: 'Do the assigned task',
  })
}

describe('social browser API and execution boundary', () => {
  it('stores encrypted worker keys, returns no key in HTTP or model tools, enables scoped grants', async () => {
    await setup()
    const overview = await ctx.client.request('GET', base, { headers: cookie })
    expect(overview.status).toBe(200)
    expect(overview.body).not.toContain(TOKEN)
    const row = ctx.repos.db.get<{ token_enc: string }>('SELECT token_enc FROM browser_desktops')!
    expect(row.token_enc).not.toContain(TOKEN)
    const tool = createSocialBrowserTools(ctx.repos, ctx.companiesRoot).find(
      (t) => t.name === 'browser_channels',
    )!
    const value = await tool.handler(
      {},
      {
        companyId,
        actorUserId: actorId,
        agentRole: 'marketing-leader',
        agentDefId: 'leader',
        taskId: null,
        conversationId: null,
        log: () => {},
      },
    )
    expect(value.content).not.toContain(TOKEN)
    expect(value.content).not.toContain(endpoint)
    expect(ctx.repos.team.resolveAgent(companyId, 'social-media').toolNames).toContain('browser_step')
  })
  it('rejects endpoints outside the operator allowlist and cross-company worker reuse', async () => {
    await setup()
    const bad = await ctx.client.request('POST', `${base}/desktops`, {
      headers: cookie,
      body: { name: 'Bad', endpoint: 'http://127.0.0.1:9999', region: 'US', token: TOKEN },
    })
    expect(bad.status).toBe(400)
    expect(() =>
      ctx.repos.socialBrowser.createDesktop(companyId, {
        name: 'Duplicate',
        endpoint,
        region: 'US',
        token: TOKEN,
      }),
    ).toThrow(/một môi trường/)
  })
  it('anonymous users cannot read metadata; viewers cannot control a signed-in browser', async () => {
    const { desktopId } = await setup(),
      viewer = await addMember(ctx, companyId, 'browser-viewer@example.com', 'viewer')
    expect((await ctx.client.request('GET', base)).status).toBe(401)
    expect((await ctx.client.request('GET', base, { headers: viewer.cookie })).status).toBe(200)
    for (const path of [
      `/desktops/${desktopId}/mode`,
      `/desktops/${desktopId}/input`,
      `/desktops/${desktopId}/test`,
    ]) {
      expect(
        (
          await ctx.client.request('POST', base + path, {
            headers: viewer.cookie,
            body: { mode: 'human', operation: 'text', text: 'secret' },
          })
        ).status,
      ).toBe(403)
    }
    expect(
      (await ctx.client.request('GET', `${base}/desktops/${desktopId}/screen`, { headers: viewer.cookie }))
        .status,
    ).toBe(403)
    expect(calls).toHaveLength(0)
  })
  it('isolates desktops, channels, content and jobs between companies', async () => {
    const { desktopId, channelId, contentId } = await setup(),
      job = createJob(channelId, contentId)
    const other = await tenant(ctx, 'browser-other@example.com', 'Other company'),
      b = `/api/companies/${other.company.id}/social-browser`
    expect((await ctx.client.request('GET', base, { headers: other.ownerCookie })).status).toBe(404)
    for (const path of [`/desktops/${desktopId}/test`, `/jobs/${job.id}/run`])
      expect((await ctx.client.request('POST', b + path, { headers: other.ownerCookie })).status).toBe(404)
    expect(() => ctx.repos.socialBrowser.content(other.company.id, contentId)).toThrow()
    expect(() => ctx.repos.socialBrowser.channel(other.company.id, channelId)).toThrow()
  })
  it('validates channel URL, scheme and lookalike domains', async () => {
    const { desktopId } = await setup()
    for (const entryUrl of [
      'https://social.example.evil.test/new',
      'http://social.example/new',
      'https://user:pass@social.example/new',
    ]) {
      const r = await ctx.client.request('POST', `${base}/channels`, {
        headers: cookie,
        body: { desktopId, name: 'Bad', platform: 'other', entryUrl, allowedHosts: ['social.example'] },
      })
      expect(r.status).toBe(400)
    }
  })
  it('creates idempotently, rejects reused keys with different content and freezes assigned content', async () => {
    const { channelId, contentId } = await setup()
    const first = createJob(channelId, contentId),
      second = createJob(channelId, contentId)
    expect(first.id).toBe(second.id)
    expect(() => createJob(channelId, undefined, 'one-job', 'read')).toThrow(/chống trùng/)
    expect(() =>
      ctx.repos.socialBrowser.saveContent(companyId, { title: 'Changed', body: 'Changed' }, contentId),
    ).toThrow(/bản mới/)
    ctx.repos.socialBrowser.setJob(companyId, first.id, 'cancelled')
    expect(() =>
      ctx.repos.socialBrowser.saveContent(companyId, { title: 'Changed', body: 'Changed' }, contentId),
    ).not.toThrow()
  })
  it('requires human handover first and allows only one active job per desktop', async () => {
    const { desktopId, channelId, contentId, service } = await setup(),
      first = createJob(channelId, contentId),
      second = createJob(channelId, contentId, 'second')
    await expect(service.action(companyId, actorId, first.id, { operation: 'start' })).rejects.toThrow(
      /đăng nhập thủ công/,
    )
    await service.mode(companyId, desktopId, 'agent')
    await service.action(companyId, actorId, first.id, { operation: 'start' })
    await expect(service.action(companyId, actorId, second.id, { operation: 'start' })).rejects.toThrow(
      /tác vụ khác/,
    )
  })
  it('manual input never enters the task events, and takeover fences new agent actions', async () => {
    const { desktopId, channelId, contentId, service } = await setup(),
      job = createJob(channelId, contentId)
    await service.mode(companyId, desktopId, 'agent')
    await service.action(companyId, actorId, job.id, { operation: 'start' })
    await service.mode(companyId, desktopId, 'human')
    const secret = 'human-password-not-for-model'
    const r = await ctx.client.request('POST', `${base}/desktops/${desktopId}/input`, {
      headers: cookie,
      body: { operation: 'text', text: secret },
    })
    expect(r.status).toBe(200)
    expect(JSON.stringify(ctx.repos.socialBrowser.events(companyId, job.id))).not.toContain(secret)
    expect(ctx.repos.socialBrowser.job(companyId, job.id).status).toBe('waiting_human')
    await expect(service.action(companyId, actorId, job.id, { operation: 'snapshot' })).rejects.toThrow(
      /không có quyền/,
    )
  })
  it('rejects login/logout navigation and unauthorized actors before reaching the worker', async () => {
    const { desktopId, channelId, contentId, service } = await setup(),
      job = createJob(channelId, contentId)
    await service.mode(companyId, desktopId, 'agent')
    await service.action(companyId, actorId, job.id, { operation: 'start' })
    const count = calls.length
    for (const url of [
      'https://social.example/login',
      'https://social.example/logout',
      'https://outside.example/post',
    ])
      await expect(
        service.action(companyId, actorId, job.id, { operation: 'navigate', url }),
      ).rejects.toThrow()
    await expect(service.action(companyId, undefined, job.id, { operation: 'snapshot' })).rejects.toThrow(
      /owner/,
    )
    expect(calls).toHaveLength(count)
  })
  it('does not mark an unverified post successful or let an executed job post again', async () => {
    const { desktopId, channelId, contentId, service } = await setup(),
      job = createJob(channelId, contentId)
    await service.mode(companyId, desktopId, 'agent')
    await service.action(companyId, actorId, job.id, { operation: 'start' })
    verified = false
    await expect(
      service.action(companyId, actorId, job.id, {
        operation: 'finish',
        resultUrl: 'https://social.example/posts/one',
      }),
    ).rejects.toThrow(/kiểm chứng/)
    expect(ctx.repos.socialBrowser.job(companyId, job.id).status).toBe('waiting_human')
    await expect(service.action(companyId, actorId, job.id, { operation: 'start' })).rejects.toThrow()
  })
  it('returns the verified post link and independently handles read-only channels', async () => {
    const { desktopId, channelId, contentId, service } = await setup(),
      job = createJob(channelId, contentId)
    await service.mode(companyId, desktopId, 'agent')
    await service.action(companyId, actorId, job.id, { operation: 'start' })
    await service.action(companyId, actorId, job.id, {
      operation: 'finish',
      resultUrl: 'https://social.example/posts/one',
      result: 'Published',
    })
    expect(ctx.repos.socialBrowser.job(companyId, job.id)).toMatchObject({
      status: 'succeeded',
      resultUrl: 'https://social.example/posts/one',
    })
    expect(ctx.repos.socialBrowser.desktop(companyId, desktopId).activeJobId).toBeNull()
    const old = ctx.repos.socialBrowser.channel(companyId, channelId)
    ctx.repos.socialBrowser.saveChannel(companyId, { ...old, canPost: false }, channelId)
    expect(() => createJob(channelId, contentId, 'bad-post')).toThrow(/chỉ cho phép đọc/)
    const read = createJob(channelId, undefined, 'read-job', 'read')
    await service.action(companyId, actorId, read.id, { operation: 'start' })
    await expect(
      service.action(companyId, actorId, read.id, { operation: 'fill', text: 'Oops' }),
    ).rejects.toThrow(/Tác vụ đọc/)
    await service.action(companyId, actorId, read.id, {
      operation: 'finish',
      result: 'Read facts with source',
    })
    expect(ctx.repos.socialBrowser.job(companyId, read.id).status).toBe('succeeded')
  })
  it('hands authentication pages back to the user and pauses interrupted jobs on restart', async () => {
    const { desktopId, channelId, contentId, service } = await setup(),
      job = createJob(channelId, contentId)
    await service.mode(companyId, desktopId, 'agent')
    needsHuman = true
    await service.action(companyId, actorId, job.id, { operation: 'start' })
    expect(ctx.repos.socialBrowser.job(companyId, job.id).status).toBe('waiting_human')
    expect(ctx.repos.socialBrowser.desktop(companyId, desktopId).mode).toBe('human')
    ctx.repos.socialBrowser.setJob(companyId, job.id, 'running')
    ctx.repos.socialBrowser.setMode(companyId, desktopId, 'agent')
    recoverBrowserJobs(ctx.app.context)
    expect(ctx.repos.socialBrowser.job(companyId, job.id).status).toBe('waiting_human')
    expect(ctx.repos.socialBrowser.desktop(companyId, desktopId).mode).toBe('paused')
  })
  it('streams original media to disk, checks type, isolates downloads and freezes assets of assigned content', async () => {
    const { contentId, channelId } = await setup()
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6mQAAAAASUVORK5CYII=',
      'base64',
    )
    async function upload(bytes: Buffer, name: string) {
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(bytes)]), name)
      return fetch(`${ctx.client.baseUrl}${base}/contents/${contentId}/assets`, {
        method: 'POST',
        headers: cookie,
        body: form,
      })
    }
    const response = await upload(png, 'original.png')
    expect(response.status, await response.clone().text()).toBe(201)
    const { asset } = (await response.json()) as {
      asset: { id: string; filename: string; sizeBytes: number }
    }
    expect(asset.filename).toBe('original.png')
    expect(asset.sizeBytes).toBe(png.length)
    expect(await readFile(browserAssetPath(ctx.companiesRoot, companyId, asset.id))).toEqual(png)
    const download = await fetch(`${ctx.client.baseUrl}${base}/assets/${asset.id}`, { headers: cookie })
    expect(Buffer.from(await download.arrayBuffer())).toEqual(png)
    const other = await tenant(ctx, 'media-other@example.com', 'Other media')
    expect(
      (
        await ctx.client.request(
          'GET',
          `/api/companies/${other.company.id}/social-browser/assets/${asset.id}`,
          { headers: other.ownerCookie },
        )
      ).status,
    ).toBe(404)
    expect((await upload(Buffer.from('pretend this is a png'), 'fake.png')).status).toBe(400)
    createJob(channelId, contentId)
    expect((await upload(png, 'later.png')).status).toBe(409)
    expect(
      (await ctx.client.request('DELETE', `${base}/assets/${asset.id}`, { headers: cookie })).status,
    ).toBe(409)
  })
  it('rejects cross-origin browser control and never forwards the supplied input', async () => {
    const { desktopId } = await setup()
    const result = await ctx.client.request('POST', `${base}/desktops/${desktopId}/input`, {
      headers: { ...cookie, Origin: 'https://unrelated.example' },
      body: { operation: 'text', text: 'must not forward' },
    })
    expect(result.status).toBe(403)
    expect(calls).toHaveLength(0)
  })
  it('runs an assigned job through the real model/tool loop and persists the verified outcome',async()=>{
    const {desktopId,channelId,contentId,service}=await setup(),job=createJob(channelId,contentId)
    const provider=ctx.repos.llm.createProvider({companyId,name:'Browser fixture model',kind:'openai_compatible',baseUrl:`${endpoint}/v1`})
    ctx.repos.llm.createProviderKey({providerId:provider.id,label:'Fixture',apiKey:TOKEN})
    const model=ctx.repos.llm.createModel({providerId:provider.id,modelId:'fixture-model',label:'Fixture model',supportsTools:true})
    const def=ctx.repos.team.findAgentDefByRole('social-media')!
    ctx.repos.team.updatePreset(companyId,def.id,{modelFk:model.id})
    await service.mode(companyId,desktopId,'agent');modelFixture=true
    const response=await ctx.client.request('POST',`${base}/jobs/${job.id}/run`,{headers:cookie})
    expect(response.status).toBe(202)
    await vi.waitFor(()=>{expect(ctx.repos.socialBrowser.job(companyId,job.id).status).toBe('succeeded')},{timeout:5000,interval:25})
    expect(ctx.repos.socialBrowser.job(companyId,job.id).resultUrl).toBe('https://social.example/posts/verified')
    expect(calls.filter(c=>c.path==='/agent').map(c=>(c.body as {operation:string}).operation)).toEqual(['start','finish'])
    expect((await ctx.client.request('POST',`${base}/jobs/${job.id}/run`,{headers:cookie})).status).toBe(409)
  })
  it('waits for an in-flight action before handing control to a human and ignores its late success',async()=>{
    const {desktopId,channelId,contentId,service}=await setup(),job=createJob(channelId,contentId)
    await service.mode(companyId,desktopId,'agent');await service.action(companyId,actorId,job.id,{operation:'start'})
    let entered!:()=>void,release!:()=>void
    const reached=new Promise<void>(resolve=>{entered=resolve}),wait=new Promise<void>(resolve=>{release=resolve})
    agentGate={entered,wait}
    const pending=service.action(companyId,actorId,job.id,{operation:'click',locator:{role:'button',name:'Publish',index:0}})
    const rejected=expect(pending).rejects.toThrow(/Quyền điều khiển/)
    await reached
    const takeover=service.mode(companyId,desktopId,'human')
    expect(ctx.repos.socialBrowser.desktop(companyId,desktopId).mode).toBe('paused')
    release();await rejected;await takeover
    expect(ctx.repos.socialBrowser.desktop(companyId,desktopId).mode).toBe('human')
    expect(ctx.repos.socialBrowser.job(companyId,job.id).status).toBe('waiting_human')
  })
  it('updates a worker connection without exposing or replacing a blank key',async()=>{
    const {desktopId}=await setup()
    const response=await ctx.client.request('PATCH',`${base}/desktops/${desktopId}`,{headers:cookie,body:{name:'Renamed',endpoint,region:'Singapore'}})
    expect(response.status).toBe(200);expect(response.body).not.toContain(TOKEN)
    expect(ctx.repos.socialBrowser.credentials(companyId,desktopId).token).toBe(TOKEN)
    expect(ctx.repos.socialBrowser.desktop(companyId,desktopId)).toMatchObject({name:'Renamed',region:'Singapore',mode:'paused'})
  })
})

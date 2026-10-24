import { randomBytes, createHash } from 'node:crypto'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { parseOrThrow } from '@marketing-agent/shared'
import { discoverMcpServer, buildToolRegistry } from '@marketing-agent/tools'
import type { AppContext } from '../context.ts'
import type { Router } from '../http/router.ts'
import { requireAuthState, requireManage, requireMembership } from '../http/middleware.ts'

const inputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  transport: z.enum(['streamable_http', 'sse', 'stdio']),
  endpoint: z.string().url().optional(), command: z.string().trim().min(1).max(500).optional(),
  args: z.array(z.string().max(500)).max(32).default([]),
  authType: z.enum(['none', 'api_key', 'bearer', 'oauth2', 'stdio_env']).default('none'),
  authConfig: z.record(z.unknown()).optional(), env: z.record(z.string().max(2000)).optional(), enabled: z.boolean().default(true),
})

function view(record: any, includeKey = false): Record<string, unknown> { return { id:record.id, name:record.name, transport:record.transport, endpoint:record.endpoint, command:record.command, args:record.args, authType:record.authType, enabled:record.enabled, status:record.status, capabilities:record.capabilities, lastCheckAt:record.lastCheckAt, lastError:record.lastError, ...(includeKey ? { serverApiKey: record.serverApiKey } : {}) } }

function apiKeyValid(ctx: any, ctxRepos: AppContext['repos'], companyId: string): boolean {
  const auth = String(ctx.req.headers.authorization ?? '')
  const provided = String(ctx.req.headers['x-api-key'] ?? '') || (auth.startsWith('Bearer ') ? auth.slice(7) : '')
  if (!provided) return false
  return ctxRepos.mcp.list(companyId).some((record) => record.enabled && (() => { try { return ctxRepos.mcp.inboundKey(record) === provided } catch { return false } })())
}

export function mcpRoutes() {
  return { name: 'mcp', register(router: Router, ctx: AppContext): void {
    const repos = ctx.repos
    router.get('/api/companies/:companyId/mcp-servers', async (request) => { request.json(200, { servers: repos.mcp.list(request.params.companyId!).map((r) => view(r)) }) }, [requireMembership(repos)])
    router.post('/api/companies/:companyId/mcp-servers', async (request) => {
      const companyId = request.params.companyId!, input = parseOrThrow(inputSchema, await request.body(), 'MCP server')
      if (input.transport === 'stdio' && !input.command) throw new Error('MCP stdio cần command')
      if (input.transport !== 'stdio' && !input.endpoint) throw new Error('MCP HTTP cần endpoint')
      const record = repos.mcp.create({ companyId, ...input })
      repos.accounting.audit({ companyId, action: 'mcp.server.create', target: record.id })
      request.json(201, { server: view(record), inboundApiKey: repos.mcp.inboundKey(record) })
    }, [requireMembership(repos), requireManage])
    router.patch('/api/companies/:companyId/mcp-servers/:serverId', async (request) => {
      const companyId = request.params.companyId!, body = await request.body<Record<string, unknown>>()
      const record = repos.mcp.update(request.params.serverId!, companyId, body as any)
      repos.accounting.audit({ companyId, action: 'mcp.server.update', target: record.id }); request.json(200, { server: view(record) })
    }, [requireMembership(repos), requireManage])
    router.delete('/api/companies/:companyId/mcp-servers/:serverId', async (request) => { const companyId=request.params.companyId!; repos.mcp.remove(request.params.serverId!,companyId); repos.accounting.audit({companyId,action:'mcp.server.delete',target:request.params.serverId!}); request.json(200,{deleted:true}) }, [requireMembership(repos), requireManage])
    router.post('/api/companies/:companyId/mcp-servers/:serverId/test', async (request) => { const companyId=request.params.companyId!, record=repos.mcp.get(request.params.serverId!,companyId); if(!record) throw new Error('MCP server không tồn tại'); try { const capabilities=await discoverMcpServer(record,repos.mcp); repos.mcp.updateDiscovery(record.id,companyId,'connected',capabilities); request.json(200,{ok:true,capabilities}) } catch(error) { repos.mcp.updateDiscovery(record.id,companyId,'error',record.capabilities,error instanceof Error?error.message:String(error)); request.json(200,{ok:false,message:error instanceof Error?error.message:String(error)}) } }, [requireMembership(repos), requireManage])
    router.get('/api/companies/:companyId/mcp-servers/:serverId/oauth/start', async (request) => {
      const auth = requireAuthState(request), companyId=request.params.companyId!, record=repos.mcp.get(request.params.serverId!,companyId); if(!record) throw new Error('MCP server không tồn tại')
      const config=repos.mcp.resolveSecrets(record).auth, authorizationEndpoint=typeof config.authorizationEndpoint==='string'?config.authorizationEndpoint:''; if(!authorizationEndpoint) throw new Error('MCP OAuth thiếu authorizationEndpoint')
      const clientId=String(config.clientId??''), redirectUri=String(config.redirectUri??`${ctx.config.publicBaseUrl??'http://127.0.0.1:3000'}/api/companies/${companyId}/mcp-servers/${record.id}/oauth/callback`), verifier=randomBytes(32).toString('base64url'), challenge=createHash('sha256').update(verifier).digest('base64url'), state=randomBytes(24).toString('base64url'); repos.mcp.createOAuthState({state,companyId,serverId:record.id,userId:auth.user.id,verifier,redirectUri,expiresAt:new Date(Date.now()+10*60_000).toISOString()}); const url=new URL(authorizationEndpoint); url.searchParams.set('response_type','code'); url.searchParams.set('client_id',clientId); url.searchParams.set('redirect_uri',redirectUri); url.searchParams.set('state',state); url.searchParams.set('code_challenge',challenge); url.searchParams.set('code_challenge_method','S256'); request.redirect(url.toString())
    }, [requireMembership(repos)])
    router.get('/api/companies/:companyId/mcp-servers/:serverId/oauth/callback', async (request) => {
      const state=repos.mcp.consumeOAuthState(request.query('state')??''); if(!state) throw new Error('MCP OAuth state không hợp lệ hoặc hết hạn'); const record=repos.mcp.get(request.params.serverId!,state.companyId); if(!record) throw new Error('MCP server không tồn tại'); const config=repos.mcp.resolveSecrets(record).auth, tokenEndpoint=typeof config.tokenEndpoint==='string'?config.tokenEndpoint:''; if(!tokenEndpoint) throw new Error('MCP OAuth thiếu tokenEndpoint'); const body=new URLSearchParams({grant_type:'authorization_code',code:request.query('code')??'',client_id:String(config.clientId??''),redirect_uri:state.redirectUri,code_verifier:state.verifier}); const response=await fetch(tokenEndpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body}); const tokens=await response.json() as Record<string,unknown>; if(!response.ok||typeof tokens.access_token!=='string') throw new Error('MCP OAuth token exchange thất bại'); repos.mcp.update(record.id,state.companyId,{authConfig:{...config,...tokens,token:tokens.access_token}}); request.redirect(`${ctx.config.publicBaseUrl??'/'}/#/cai-dat?tab=integrations&mcp_oauth=success`)
    })

    const serve = async (request: any) => {
      if (!apiKeyValid(request, ctx.repos, request.params.companyId!)) { request.json(401, { error: { code: 'unauthorized', message: 'MCP API key không hợp lệ' } }); return }
      const companyId = request.params.companyId!, server = new McpServer({ name: 'marketing-agent', version: '0.1.0' }, { capabilities: { tools: {}, resources: {}, prompts: {} }, maxToolInputElements: 1000 })
      const registry = buildToolRegistry({ repos: ctx.repos, coreOptions: { companiesRoot: ctx.config.companiesRoot } }).registry
      for (const tool of registry?.list() ?? []) {
        const definition = registry?.get(tool.name); if (!definition) continue
        server.registerTool(tool.name, { description: definition.description, inputSchema: z.record(z.unknown()) }, async (args: Record<string, unknown>) => {
          const result = await registry.execute(tool.name, args as Record<string, unknown>, { companyId, agentRole: 'marketing-leader', agentDefId: 'mcp', taskId: null, conversationId: null, log: () => undefined }, [tool.name])
          return { content: [{ type: 'text', text: result.content }], isError: result.isError }
        })
      }
      server.registerResource('status', 'marketing://status', { description: 'Trạng thái MCP của Marketing Agent', mimeType: 'application/json' }, async () => ({ contents: [{ uri: 'marketing://status', mimeType: 'application/json', text: JSON.stringify({ companyId, tools: ctx.listToolNames() }) }] }))
      server.registerPrompt('marketing_brief', { description: 'Tạo brief marketing có cấu trúc' }, async () => ({ messages: [{ role: 'user', content: { type: 'text', text: 'Hãy làm rõ mục tiêu, KPI, phạm vi, thời hạn, ngân sách và ràng buộc trước khi lập kế hoạch.' } }] }))
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      await server.connect(transport)
      const body = request.method === 'POST' ? await request.body() : undefined
      await transport.handleRequest(request.req, request.res, body)
    }
    router.add('POST', '/mcp/:companyId', serve)
    router.add('GET', '/mcp/:companyId', serve)
    router.add('DELETE', '/mcp/:companyId', serve)
    router.add('POST', '/mcp/:companyId/sse', serve)
    router.add('GET', '/mcp/:companyId/sse', serve)
  } }
}

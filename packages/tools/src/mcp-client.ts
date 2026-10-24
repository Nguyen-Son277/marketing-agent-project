import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { ToolDefinition, ToolResult, ToolContext } from '@marketing-agent/shared'
import type { McpServerRecord, McpCapabilitySnapshot, McpTransport } from '@marketing-agent/db'
import type { McpRepo } from '@marketing-agent/db'
import { defineTool } from './registry.ts'

const MAX_RESULT = 512_000
const safeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'server'
type Auth = Record<string, unknown>

export interface McpClientConnection { client: Client; close(): Promise<void>; snapshot: McpCapabilitySnapshot }

function headers(auth: Auth): Record<string, string> {
  const token = typeof auth.token === 'string' ? auth.token : typeof auth.apiKey === 'string' ? auth.apiKey : undefined
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function connectMcpServer(record: McpServerRecord, secrets: McpRepo, signal?: AbortSignal): Promise<McpClientConnection> {
  const resolved = secrets.resolveSecrets(record)
  let transport: StreamableHTTPClientTransport | SSEClientTransport | StdioClientTransport
  if (record.transport === 'stdio') {
    if (!record.command) throw new Error('MCP stdio thiếu command')
    const params: StdioServerParameters = { command: record.command, args: record.args, env: { ...resolved.env }, stderr: 'pipe', maxBufferSize: MAX_RESULT }
    transport = new StdioClientTransport(params)
  } else {
    if (!record.endpoint) throw new Error('MCP HTTP thiếu endpoint')
    const init: RequestInit = { headers: headers(resolved.auth), signal }
    transport = record.transport === 'sse'
      ? new SSEClientTransport(new URL(record.endpoint), { requestInit: init })
      : new StreamableHTTPClientTransport(new URL(record.endpoint), { requestInit: init, reconnectionOptions: { maxReconnectionDelay: 10_000, initialReconnectionDelay: 250, reconnectionDelayGrowFactor: 1.5, maxRetries: 2 } })
  }
  const client = new Client({ name: 'marketing-agent', version: '0.1.0' }, { capabilities: { roots: { listChanged: false } } })
  await client.connect(transport)
  const [tools, resources, prompts] = await Promise.all([
    client.listTools(), client.listResources().catch(() => ({ resources: [] })), client.listPrompts().catch(() => ({ prompts: [] })),
  ])
  const snapshot: McpCapabilitySnapshot = { tools: tools.tools as unknown[], resources: resources.resources as unknown[], prompts: prompts.prompts as unknown[] }
  return { client, snapshot, close: () => transport.close() }
}

export async function discoverMcpServer(record: McpServerRecord, repo: McpRepo): Promise<McpCapabilitySnapshot> {
  const connection = await connectMcpServer(record, repo)
  try { return connection.snapshot } finally { await connection.close() }
}

export async function createMcpToolsForCompany(repo: McpRepo, companyId: string): Promise<ToolDefinition[]> {
  const out: ToolDefinition[] = []
  for (const record of repo.list(companyId).filter((item) => item.enabled)) {
    let snapshot: McpCapabilitySnapshot
    try { snapshot = await discoverMcpServer(record, repo); repo.updateDiscovery(record.id, companyId, 'connected', snapshot) } catch (error) { repo.updateDiscovery(record.id, companyId, 'error', record.capabilities, error instanceof Error ? error.message : String(error)); continue }
    for (const capability of snapshot.tools as Array<{ name?: string; description?: string; inputSchema?: unknown }>) {
      if (!capability.name) continue
      const name = `mcp_${safeName(record.name)}_${safeName(capability.name)}`
      out.push(defineTool({ name, description: `[MCP ${record.name}] ${capability.description ?? capability.name}`, parameters: (capability.inputSchema as ToolDefinition['parameters']) ?? { type: 'object', properties: {}, additionalProperties: true }, handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        if (ctx.companyId !== companyId) return { content: 'MCP tool không thuộc công ty hiện tại.', isError: true }
        const connection = await connectMcpServer(record, repo, ctx.signal)
        try {
          const result = await connection.client.callTool({ name: capability.name!, arguments: args }, undefined, { signal: ctx.signal })
          const text = JSON.stringify(result).slice(0, MAX_RESULT)
          ctx.log(`mcp ${record.name}/${capability.name}`, { serverId: record.id })
          return { content: text, data: result }
        } finally { await connection.close() }
      } }))
    }
    for (const resource of snapshot.resources as Array<{ uri?: string; name?: string; description?: string }>) {
      if (!resource.uri) continue
      const name = `mcp_${safeName(record.name)}_resource_${safeName(resource.name ?? resource.uri)}`
      out.push(defineTool({
        name,
        description: `[MCP ${record.name}] Đọc resource ${resource.name ?? resource.uri}`,
        parameters: { type: 'object', properties: { uri: { type: 'string', description: resource.uri } }, additionalProperties: false },
        handler: async (_args, ctx) => {
          const connection = await connectMcpServer(record, repo, ctx.signal)
          try { const result = await connection.client.readResource({ uri: resource.uri! }, { signal: ctx.signal }); return { content: JSON.stringify(result).slice(0, MAX_RESULT), data: result } }
          finally { await connection.close() }
        },
      }))
    }
    for (const prompt of snapshot.prompts as Array<{ name?: string; description?: string; arguments?: unknown }>) {
      if (!prompt.name) continue
      const name = `mcp_${safeName(record.name)}_prompt_${safeName(prompt.name)}`
      out.push(defineTool({
        name,
        description: `[MCP ${record.name}] Lấy prompt ${prompt.description ?? prompt.name}`,
        parameters: { type: 'object', properties: { arguments: { type: 'object', additionalProperties: true } }, additionalProperties: false },
        handler: async (args, ctx) => {
          const connection = await connectMcpServer(record, repo, ctx.signal)
          try { const result = await connection.client.getPrompt({ name: prompt.name!, arguments: (args.arguments ?? {}) as Record<string, string> }, { signal: ctx.signal }); return { content: JSON.stringify(result).slice(0, MAX_RESULT), data: result } }
          finally { await connection.close() }
        },
      }))
    }
  }
  return out
}

export function mcpCapabilityNames(snapshot: McpCapabilitySnapshot): string[] { return [...snapshot.tools, ...snapshot.resources, ...snapshot.prompts].map((value: any) => String(value.name ?? value.uri ?? '')).filter(Boolean) }

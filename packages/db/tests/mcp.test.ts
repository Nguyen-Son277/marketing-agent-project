import { describe, expect, it } from 'vitest'
import { createRepos } from '../src/index.ts'

describe('MCP repository', () => {
  it('stores credentials encrypted and isolates by company', () => {
    const repos = createRepos({ file: ':memory:', appSecret: 'mcp-test-secret-123456', allowWeakSecret: true })
    repos.db.run('INSERT INTO companies (id,name,slug,created_at) VALUES (?,?,?,?)', ['mcp-company-a', 'A', 'mcp-a', new Date().toISOString()])
    repos.db.run('INSERT INTO companies (id,name,slug,created_at) VALUES (?,?,?,?)', ['mcp-company-b', 'B', 'mcp-b', new Date().toISOString()])
    const created = repos.mcp.create({ companyId: 'mcp-company-a', name: 'Remote', transport: 'streamable_http', endpoint: 'https://example.test/mcp', authType: 'bearer', authConfig: { token: 'secret-token' } })
    expect(repos.mcp.list('mcp-company-b')).toEqual([])
    expect(repos.mcp.resolveSecrets(created).auth).toEqual({ token: 'secret-token' })
    expect(created.authConfigEnc).not.toContain('secret-token')
    expect(repos.mcp.inboundKey(created)).toHaveLength(43)
    repos.mcp.updateDiscovery(created.id, created.companyId, 'connected', { tools: [{ name: 'hello' }], resources: [], prompts: [] })
    expect(repos.mcp.get(created.id, created.companyId)?.status).toBe('connected')
    repos.db.close()
  })
})

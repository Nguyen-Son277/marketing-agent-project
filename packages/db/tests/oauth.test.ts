import { describe, expect, it } from 'vitest'
import { createRepos } from '../src/index.ts'

describe('OAuth repository', () => {
  it('encrypts app credentials and consumes one-time state', () => {
    const repos = createRepos({ file: ':memory:', appSecret: 'oauth-test-secret-123456', allowWeakSecret: true })
    const user = repos.auth.createUser({ email: 'oauth@example.com', password: 'password-123456', name: 'OAuth user', approvalStatus: 'approved' })
    const companyId = 'company-oauth-test'
    repos.db.run('INSERT INTO companies (id, name, slug, created_at) VALUES (?, ?, ?, ?)', [companyId, 'OAuth test', 'oauth-test', new Date().toISOString()])
    repos.auth.addMembership(companyId, user.id, 'owner')
    const company = repos.auth.findCompanyById(companyId)!
    const app = repos.oauth.upsertApp({ companyId: company.id, provider: 'google', clientId: 'client-id', clientSecret: 'client-secret' })
    expect(repos.oauth.resolveApp(app)).toEqual({ clientId: 'client-id', clientSecret: 'client-secret' })
    expect(app.clientIdEnc).not.toContain('client-id')
    const state = repos.oauth.createState({ state: 'state-123', companyId: company.id, userId: user.id, provider: 'google', redirectUri: 'https://example.test/oauth/google/callback', codeVerifier: 'verifier', expiresAt: new Date(Date.now() + 60_000).toISOString() })
    expect(repos.oauth.resolveCodeVerifier(state)).toBe('verifier')
    expect(repos.oauth.consumeState('state-123')?.companyId).toBe(company.id)
    expect(repos.oauth.consumeState('state-123')).toBeUndefined()
    repos.db.close()
  })
})

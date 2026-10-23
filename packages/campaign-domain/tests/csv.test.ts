import { describe, expect, it } from 'vitest'
import { parseContactCsv } from '../src/index.ts'

describe('CampaignLoop consent CSV', () => {
  it('parses quoted names, deduplicates email and supplies consent defaults', () => {
    const contacts = parseContactCsv('email,name\nfirst@example.com,"A, One"\nFIRST@example.com,A duplicate\n', {
      source: 'landing-form',
      consentVersion: '2026-01',
      consentAt: '2026-01-01T00:00:00.000Z',
    })
    expect(contacts).toHaveLength(1)
    expect(contacts[0]).toMatchObject({ email: 'first@example.com', name: 'A, One', source: 'landing-form', consentVersion: '2026-01' })
  })
})

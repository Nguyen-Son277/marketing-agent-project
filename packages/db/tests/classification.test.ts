import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRepos, type Repos } from '../src/index.ts'

let repos: Repos
beforeEach(() => {
  repos = createRepos({ file: ':memory:', allowWeakSecret: true })
  repos.db.run('INSERT INTO companies (id, name, slug, created_at) VALUES (?, ?, ?, ?)', ['class-c', 'Class', 'class', 'now'])
})
afterEach(() => repos.db.close())

const doc = () => repos.knowledge.upsertDocumentAndChunks({
  companyId: 'class-c', path: 'uploads/a.md', title: 'A', category: 'general', tags: ['origin'],
  content: '# Canonical\n\nText', source: 'upload-auto',
}, [])

describe('knowledge classification persistence', () => {
  it('queues, claims, recovers, and finishes a document-scoped job', () => {
    const document = doc()
    const jobId = repos.knowledge.enqueueClassification('class-c', document.id)
    expect(jobId).toBeTruthy()
    expect(repos.knowledge.enqueueClassification('class-c', document.id)).toBe(jobId)
    expect(repos.knowledge.claimClassificationJob()).toMatchObject({ id: jobId, status: 'running', attempts: 1, nextAttemptAt: null })
    expect(repos.knowledge.recoverClassificationJobs()).toBe(1)
    expect(repos.knowledge.claimClassificationJob()?.status).toBe('running')
    expect(repos.knowledge.finishClassificationJob(jobId)).toBe(true)
    expect(repos.knowledge.getClassificationJob('class-c', document.id)).toMatchObject({ status: 'ready', nextAttemptAt: null })
    expect(repos.knowledge.finishClassificationJob(jobId)).toBe(false)
  })

  it('defers pending retries until due without incrementing attempts', () => {
    const document = doc()
    const jobId = repos.knowledge.enqueueClassification('class-c', document.id)
    expect(repos.knowledge.claimClassificationJob()?.attempts).toBe(1)
    const scheduled = new Date(Date.now() + 60_000).toISOString()
    expect(repos.knowledge.deferClassificationJob(jobId, 'temporary failure', scheduled)).toBe(true)
    expect(repos.knowledge.getClassificationJob('class-c', document.id)).toMatchObject({
      status: 'pending', error: 'temporary failure', attempts: 1, nextAttemptAt: scheduled,
    })
    expect(repos.knowledge.claimClassificationJob()).toBeUndefined()
    repos.db.run('UPDATE kb_classification_jobs SET next_attempt_at = ? WHERE id = ?', ['2000-01-01T00:00:00.000Z', jobId])
    expect(repos.knowledge.claimClassificationJob()).toMatchObject({ id: jobId, status: 'running', attempts: 2 })
    expect(repos.knowledge.finishClassificationJob(jobId, 'exhausted')).toBe(true)
    expect(repos.knowledge.getClassificationJob('class-c', document.id)).toMatchObject({ status: 'failed', error: 'exhausted', nextAttemptAt: null })
  })

  it('manual retry resets attempts and schedule, but leaves pending and running jobs alone', () => {
    const document = doc()
    const jobId = repos.knowledge.enqueueClassification('class-c', document.id)
    expect(repos.knowledge.retryClassification('class-c', document.id)).toBe(false)
    expect(repos.knowledge.claimClassificationJob()?.id).toBe(jobId)
    expect(repos.knowledge.retryClassification('class-c', document.id)).toBe(false)
    expect(repos.knowledge.finishClassificationJob(jobId, 'failure')).toBe(true)
    repos.db.run('UPDATE kb_classification_jobs SET attempts = 5, next_attempt_at = ? WHERE id = ?', ['2099-01-01T00:00:00.000Z', jobId])
    expect(repos.knowledge.retryClassification('class-c', document.id)).toBe(true)
    expect(repos.knowledge.getClassificationJob('class-c', document.id)).toMatchObject({ status: 'pending', attempts: 0, nextAttemptAt: null, error: null })
    expect(repos.knowledge.retryClassification('class-c', document.id)).toBe(false)
  })

  it('does not claim or defer a job after its source document is deleted', () => {
    const document = doc()
    const jobId = repos.knowledge.enqueueClassification('class-c', document.id)
    expect(repos.knowledge.claimClassificationJob()?.id).toBe(jobId)
    repos.db.run('DELETE FROM kb_documents WHERE id = ?', [document.id])
    expect(repos.knowledge.deferClassificationJob(jobId, 'late error', new Date().toISOString())).toBe(false)
  })

  it('recovers only upload-auto jobs', () => {
    const document = doc()
    const jobId = repos.knowledge.enqueueClassification('class-c', document.id)
    expect(repos.knowledge.claimClassificationJob()?.id).toBe(jobId)
    repos.db.run("UPDATE kb_documents SET source = 'ui' WHERE id = ?", [document.id])
    expect(repos.knowledge.recoverClassificationJobs()).toBe(0)
    expect(repos.knowledge.getClassificationJob('class-c', document.id)?.status).toBe('running')
  })

  it('atomically persists sections and annotated chunks and supports corrections', () => {
    const document = doc()
    const sections = [{ ordinal: 0, startOffset: 0, endOffset: 18, title: 'Intro', category: 'brand', tags: ['tone'], confidence: 0.9, assignmentSource: 'auto' }]
    expect(repos.knowledge.replaceSectionsAndChunks('class-c', document.id, sections, [
      { ordinal: 0, sectionOrdinal: 0, text: 'Canonical text', headingPath: 'Intro', tokens: 2, category: 'brand' },
    ])).toBe(true)
    const section = repos.knowledge.listSections('class-c', document.id)[0]!
    expect(section).toMatchObject({ category: 'brand', tagsJson: '["tone"]', confidence: 0.9 })
    const chunkId = repos.knowledge.listChunks(document.id)[0]!.id
    expect(repos.db.get<{section_id: string; category: string}>('SELECT section_id, category FROM kb_chunks WHERE id = ?', [chunkId]))
      .toMatchObject({ section_id: section.id, category: 'brand' })
    expect(repos.knowledge.updateSection('class-c', document.id, section.id, { category: 'products', tags: ['catalog'] })).toBe(true)
    expect(repos.db.get<{category: string}>('SELECT category FROM kb_chunks WHERE id = ?', [chunkId])?.category).toBe('products')
    expect(repos.knowledge.documentContent('class-c', document.id)).toBe('# Canonical\n\nText')
  })

  it('excludes a queued auto-classification document from lexical search', () => {
    const document = doc()
    expect(repos.knowledge.enqueueClassification('class-c', document.id)).toBeTruthy()
    expect(repos.knowledge.lexicalSearch('class-c', 'Canonical', { k: 5, categories: ['general'] })).toEqual([])
  })
})

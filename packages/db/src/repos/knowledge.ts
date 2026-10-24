/** Knowledge documents, chunks, embeddings, and ACL-filtered retrieval. */
import {
  newId,
  nowIso,
  sha256,
  type KbChunkRecord,
  type KbDocumentRecord,
  type KbHit,
  type KbIndexStatus,
  type KbSectionRecord,
  type ClassificationJobRecord,
} from '@marketing-agent/shared'
import type { Database } from '../database.ts'
import { cosineSimilarity, encodeVector, decodeVector } from '../vector.ts'

interface DocRow {
  id: string
  company_id: string
  path: string
  title: string
  category: string
  tags_json: string
  checksum: string
  mtime: string | null
  version: number
  source: string
  created_by: string | null
  created_at: string
  updated_at: string
  content: string | null
  original_name: string | null
  mime_type: string | null
  size_bytes: number | null
  storage_key: string | null
  original_checksum: string | null
  image_product: string | null
  image_description: string | null
  image_analysis_status: 'none' | 'pending' | 'running' | 'ready' | 'failed'
  image_analysis_error: string | null
}

interface ChunkRow {
  id: string
  document_id: string
  company_id: string
  ordinal: number
  text: string
  heading_path: string | null
  tokens: number
  section_id?: string | null
  category?: string | null
}

interface SectionRow {
  id: string; company_id: string; document_id: string; ordinal: number
  start_offset: number; end_offset: number; title: string; category: string
  tags_json: string; confidence: number; assignment_source: string
}

interface ClassificationJobRow {
  id: string; company_id: string; document_id: string; status: 'pending' | 'running' | 'ready' | 'failed'
  error: string | null; attempts: number; next_attempt_at: string | null; created_at: string; updated_at: string
}

const toSection = (row: SectionRow): KbSectionRecord => ({
  id: row.id, companyId: row.company_id, documentId: row.document_id, ordinal: row.ordinal,
  startOffset: row.start_offset, endOffset: row.end_offset, title: row.title, category: row.category,
  tagsJson: row.tags_json, confidence: row.confidence, assignmentSource: row.assignment_source,
})

const toClassificationJob = (row: ClassificationJobRow): ClassificationJobRecord => ({
  id: row.id, companyId: row.company_id, documentId: row.document_id, status: row.status,
  error: row.error, attempts: row.attempts, nextAttemptAt: row.next_attempt_at,
  createdAt: row.created_at, updatedAt: row.updated_at,
})

export interface KbSectionInput {
  readonly ordinal: number
  readonly startOffset: number
  readonly endOffset: number
  readonly title: string
  readonly category: string
  readonly tags: readonly string[]
  readonly confidence: number
  readonly assignmentSource: string
}

export interface SectionUpdate { readonly category: string; readonly tags: readonly string[] }

interface EmbeddingRow {
  chunk_id: string
  company_id: string
  dim: number
  norm: number
  vec: Buffer
  model: string
}

const toDocument = (row: DocRow): KbDocumentRecord => ({
  id: row.id,
  companyId: row.company_id,
  path: row.path,
  title: row.title,
  category: row.category,
  tagsJson: row.tags_json,
  checksum: row.checksum,
  mtime: row.mtime,
  version: row.version,
  source: row.source,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  content: row.content,
  originalName: row.original_name,
  mimeType: row.mime_type,
  sizeBytes: row.size_bytes,
  storageKey: row.storage_key,
  originalChecksum: row.original_checksum,
  imageProduct: row.image_product,
  imageDescription: row.image_description,
  imageAnalysisStatus: row.image_analysis_status,
  imageAnalysisError: row.image_analysis_error,
})

const toChunk = (row: ChunkRow): KbChunkRecord => ({
  category: row.category ?? null,
  sectionId: row.section_id ?? null,
  id: row.id,
  documentId: row.document_id,
  companyId: row.company_id,
  ordinal: row.ordinal,
  text: row.text,
  headingPath: row.heading_path,
  tokens: row.tokens,
})

export interface ChunkInput {
  readonly ordinal: number
  readonly text: string
  readonly headingPath: string | null
  readonly tokens: number
  readonly sectionOrdinal?: number
  readonly sectionId?: string | null
  readonly category?: string | null
}

export interface UpsertDocumentInput {
  readonly companyId: string
  readonly path: string
  readonly title: string
  readonly category: string
  readonly tags: readonly string[]
  readonly content: string
  readonly source?: string
  readonly userId?: string | null
  readonly mtime?: string | null
}

export interface UploadMetadata {
  readonly originalName: string | null
  readonly mimeType: string | null
  readonly sizeBytes: number | null
  readonly storageKey: string | null
  readonly originalChecksum: string | null
  readonly imageProduct?: string | null
  readonly imageDescription?: string | null
  readonly imageAnalysisStatus?: 'none' | 'pending' | 'running' | 'ready' | 'failed'
  readonly imageAnalysisError?: string | null
}

export class KnowledgeRepo {
  constructor(private readonly db: Database) {}

  findDocument(companyId: string, path: string): KbDocumentRecord | undefined {
    const row = this.db.get<DocRow>('SELECT * FROM kb_documents WHERE company_id = ? AND path = ?', [companyId, path])
    return row ? toDocument(row) : undefined
  }

  findDocumentById(id: string, companyId: string): KbDocumentRecord | undefined {
    const row = this.db.get<DocRow>('SELECT * FROM kb_documents WHERE id = ? AND company_id = ?', [id, companyId])
    return row ? toDocument(row) : undefined
  }

  /** Read canonical source text, always scoped to the owning company. */
  documentContent(companyId: string, documentId: string): string | null {
    return this.db.get<{ content: string | null }>(
      'SELECT content FROM kb_documents WHERE company_id = ? AND id = ?',
      [companyId, documentId],
    )?.content ?? null
  }

  /** Find a previous upload by original-file checksum within one company. */
  findUploadByChecksum(companyId: string, originalChecksum: string, category?: string): KbDocumentRecord | undefined {
    const row = this.db.get<DocRow>(
      `SELECT * FROM kb_documents WHERE company_id = ? AND original_checksum = ?${category ? ' AND category = ?' : ''} LIMIT 1`,
      category ? [companyId, originalChecksum, category] : [companyId, originalChecksum],
    )
    return row ? toDocument(row) : undefined
  }

  /** Update upload metadata without disturbing canonical text or index state. */
  setUploadMetadata(companyId: string, documentId: string, metadata: UploadMetadata): boolean {
    return this.db.run(
      `UPDATE kb_documents SET original_name = @originalName, mime_type = @mimeType,
         size_bytes = @sizeBytes, storage_key = @storageKey, original_checksum = @originalChecksum,
         image_product = COALESCE(@imageProduct, image_product), image_description = COALESCE(@imageDescription, image_description),
         image_analysis_status = COALESCE(@imageAnalysisStatus, image_analysis_status), image_analysis_error = @imageAnalysisError
       WHERE company_id = @companyId AND id = @documentId`,
      { imageProduct: null, imageDescription: null, imageAnalysisStatus: null, imageAnalysisError: null, ...metadata, companyId, documentId },
    ).changes > 0
  }

  requireDocument(id: string, companyId: string): KbDocumentRecord {
    const doc = this.findDocumentById(id, companyId)
    if (!doc) throw new Error('Không tìm thấy tài liệu')
    return doc
  }

  listDocuments(
    companyId: string,
    options: { categories?: readonly string[]; query?: string; limit?: number } = {},
  ): KbDocumentRecord[] {
    const params: unknown[] = [companyId]
    let sql = 'SELECT * FROM kb_documents WHERE company_id = ?'
    if (options.categories && options.categories.length > 0) {
      sql += ` AND category IN (${options.categories.map(() => '?').join(', ')})`
      params.push(...options.categories)
    }
    if (options.query) {
      sql += ' AND (title LIKE ? OR path LIKE ?)'
      const like = `%${options.query}%`
      params.push(like, like)
    }
    sql += ' ORDER BY category ASC, path ASC LIMIT ?'
    params.push(options.limit ?? 500)
    return this.db.all<DocRow>(sql, params).map(toDocument)
  }

  /** Product images available to a company, optionally matched against metadata. */
  listProductImages(companyId: string, query?: string, limit = 50): KbDocumentRecord[] {
    const params: unknown[] = [companyId]
    let sql = `SELECT * FROM kb_documents WHERE company_id = ? AND mime_type LIKE 'image/%'`
    if (query?.trim()) { sql += ' AND (title LIKE ? OR image_product LIKE ? OR image_description LIKE ? OR tags_json LIKE ?)'; const like = `%${query.trim()}%`; params.push(like, like, like, like) }
    sql += ' ORDER BY updated_at DESC LIMIT ?'; params.push(limit)
    return this.db.all<DocRow>(sql, params).map(toDocument)
  }

  /** Insert or replace a document and its chunk set in one transaction. */
  upsertDocumentAndChunks(input: UpsertDocumentInput, chunks: readonly ChunkInput[]): KbDocumentRecord {
    const checksum = sha256(input.content)
    return this.db.tx(() => {
      const existing = this.findDocument(input.companyId, input.path)
      const id = existing?.id ?? newId()
      const createdAt = existing?.createdAt ?? nowIso()
      const version = (existing?.version ?? 0) + 1
      const now = nowIso()
      if (existing) {
        this.db.run(
          `UPDATE kb_documents
              SET title = @title, category = @category, tags_json = @tags, checksum = @checksum,
                  content = @content, mtime = @mtime, version = @version, source = @source, updated_at = @updatedAt
            WHERE id = @id`,
          {
            id,
            title: input.title,
            category: input.category,
            tags: JSON.stringify(input.tags),
            checksum,
            content: input.content,
            mtime: input.mtime ?? null,
            version,
            source: input.source ?? existing.source,
            updatedAt: now,
          },
        )
      } else {
        this.db.run(
          `INSERT INTO kb_documents
             (id, company_id, path, title, category, tags_json, checksum, content, mtime, version, source, created_by, created_at, updated_at)
           VALUES (@id, @companyId, @path, @title, @category, @tags, @checksum, @content, @mtime, @version, @source, @userId, @createdAt, @updatedAt)`,
          {
            id,
            companyId: input.companyId,
            path: input.path,
            title: input.title,
            category: input.category,
            tags: JSON.stringify(input.tags),
            checksum,
            content: input.content,
            mtime: input.mtime ?? null,
            version,
            source: input.source ?? 'ui',
            userId: input.userId ?? null,
            createdAt,
            updatedAt: now,
          },
        )
      }
      this.replaceChunks(id, input.companyId, chunks)
      return this.findDocument(input.companyId, input.path)!
    })
  }

  enqueueClassification(companyId: string, documentId: string): string {
    const id = newId()
    const now = nowIso()
    this.db.run(
      `INSERT INTO kb_classification_jobs (id, company_id, document_id, status, error, attempts, created_at, updated_at)
       SELECT ?, ?, ?, 'pending', NULL, 0, ?, ?
        WHERE EXISTS (SELECT 1 FROM kb_documents WHERE id = ? AND company_id = ?)
       ON CONFLICT(company_id, document_id) DO NOTHING`,
      [id, companyId, documentId, now, now, documentId, companyId],
    )
    return this.getClassificationJob(companyId, documentId)?.id ?? ''
  }

  retryClassification(companyId: string, documentId: string): boolean {
    return this.db.run(
      `UPDATE kb_classification_jobs AS j
          SET status = 'pending', error = NULL, attempts = 0, next_attempt_at = NULL, updated_at = ?
        WHERE j.company_id = ? AND j.document_id = ? AND j.status IN ('failed', 'ready')
          AND EXISTS (SELECT 1 FROM kb_documents d WHERE d.id = j.document_id AND d.company_id = j.company_id)`,
      [nowIso(), companyId, documentId],
    ).changes > 0
  }

  deferClassificationJob(id: string, error: string, nextAttemptAt: string): boolean {
    return this.db.run(
      `UPDATE kb_classification_jobs AS j
          SET status = 'pending', error = ?, next_attempt_at = ?, updated_at = ?
        WHERE j.id = ? AND j.status = 'running'
          AND EXISTS (SELECT 1 FROM kb_documents d WHERE d.id = j.document_id AND d.company_id = j.company_id)`,
      [error, nextAttemptAt, nowIso(), id],
    ).changes > 0
  }

  getClassificationJob(companyId: string, documentId: string): ClassificationJobRecord | undefined {
    const row = this.db.get<ClassificationJobRow>(
      'SELECT * FROM kb_classification_jobs WHERE company_id = ? AND document_id = ?', [companyId, documentId],
    )
    return row ? toClassificationJob(row) : undefined
  }

  claimClassificationJob(): ClassificationJobRecord | undefined {
    return this.db.tx(() => {
      const row = this.db.get<ClassificationJobRow>(
        `SELECT * FROM kb_classification_jobs
          WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
          ORDER BY created_at, id LIMIT 1`, [nowIso()],
      )
      if (!row) return undefined
      const now = nowIso()
      const updated = this.db.run(
        `UPDATE kb_classification_jobs AS j SET status = 'running', attempts = attempts + 1, updated_at = ?
          WHERE j.id = ? AND j.status = 'pending'
            AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= ?)
            AND EXISTS (SELECT 1 FROM kb_documents d WHERE d.id = j.document_id AND d.company_id = j.company_id)`,
        [now, row.id, now],
      )
      if (!updated.changes) return undefined
      return this.getClassificationJob(row.company_id, row.document_id)
    })
  }

  finishClassificationJob(id: string, error?: string): boolean {
    return this.db.run(
      `UPDATE kb_classification_jobs AS j SET status = ?, error = ?, next_attempt_at = NULL, updated_at = ?
        WHERE j.id = ? AND j.status = 'running'
          AND EXISTS (SELECT 1 FROM kb_documents d WHERE d.id = j.document_id AND d.company_id = j.company_id)`,
      [error ? 'failed' : 'ready', error ?? null, nowIso(), id],
    ).changes > 0
  }

  recoverClassificationJobs(): number {
    return this.db.run(
      `UPDATE kb_classification_jobs AS j SET status = 'pending', updated_at = ? WHERE j.status = 'running'
         AND EXISTS (SELECT 1 FROM kb_documents d WHERE d.id = j.document_id AND d.company_id = j.company_id AND d.source = 'upload-auto')`,
      [nowIso()],
    ).changes
  }

  listSections(companyId: string, documentId: string): KbSectionRecord[] {
    return this.db.all<SectionRow>(
      'SELECT * FROM kb_sections WHERE company_id = ? AND document_id = ? ORDER BY ordinal',
      [companyId, documentId],
    ).map(toSection)
  }

  replaceSectionsAndChunks(companyId: string, documentId: string, sections: readonly KbSectionInput[], chunks: readonly ChunkInput[]): boolean {
    return this.db.tx(() => {
      if (!this.findDocumentById(documentId, companyId)) return false
      this.db.run('DELETE FROM kb_chunks_fts WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE company_id = ? AND document_id = ?)', [companyId, documentId])
      this.db.run('DELETE FROM kb_sections WHERE company_id = ? AND document_id = ?', [companyId, documentId])
      const sectionIds = new Map<number, string>()
      for (const section of sections) {
        const id = newId(); sectionIds.set(section.ordinal, id)
        this.db.run(
          `INSERT INTO kb_sections (id, company_id, document_id, ordinal, start_offset, end_offset, title, category, tags_json, confidence, assignment_source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, companyId, documentId, section.ordinal, section.startOffset, section.endOffset, section.title,
            section.category, JSON.stringify(section.tags), section.confidence, section.assignmentSource],
        )
      }
      const assigned = chunks.map((chunk) => ({ ...chunk, sectionId: chunk.sectionId ?? sectionIds.get(chunk.sectionOrdinal ?? chunk.ordinal) ?? null }))
      this.replaceChunks(documentId, companyId, assigned)
      return true
    })
  }

  updateSection(companyId: string, documentId: string, sectionId: string, update: SectionUpdate): boolean {
    return this.db.tx(() => {
      const changed = this.db.run(
        `UPDATE kb_sections SET category = ?, tags_json = ?, assignment_source = 'manual' WHERE id = ? AND company_id = ? AND document_id = ?`,
        [update.category, JSON.stringify(update.tags), sectionId, companyId, documentId],
      ).changes
      if (!changed) return false
      this.db.run('UPDATE kb_chunks SET category = ? WHERE section_id = ? AND company_id = ?',
        [update.category, sectionId, companyId])
      return true
    })
  }

  /** Replace the chunk rows for a document; embeddings cascade away with them. */
  replaceChunks(documentId: string, companyId: string, chunks: readonly ChunkInput[]): void {
    // FTS rows carry no foreign key, so they must be cleared while the chunk ids still exist.
    this.db.run('DELETE FROM kb_chunks_fts WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE document_id = ?)', [
      documentId,
    ])
    this.db.run('DELETE FROM kb_chunks WHERE document_id = ?', [documentId])
    for (const chunk of chunks) {
      const id = newId()
      this.db.run(
        `INSERT INTO kb_chunks (id, document_id, company_id, ordinal, text, heading_path, tokens, section_id, category)
         VALUES (@id, @documentId, @companyId, @ordinal, @text, @headingPath, @tokens, @sectionId, @category)`,
        {
          id,
          documentId,
          companyId,
          ordinal: chunk.ordinal,
          text: chunk.text,
          headingPath: chunk.headingPath,
          tokens: chunk.tokens,
          sectionId: chunk.sectionId ?? null,
          category: chunk.category ?? null,
        },
      )
      this.db.run('INSERT INTO kb_chunks_fts (text, chunk_id, company_id) VALUES (?, ?, ?)', [
        chunk.text,
        id,
        companyId,
      ])
    }
  }

  deleteDocument(companyId: string, path: string): boolean {
    const doc = this.findDocument(companyId, path)
    if (!doc) return false
    return this.db.tx(() => {
      this.db.run('DELETE FROM kb_chunks_fts WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE document_id = ?)', [
        doc.id,
      ])
      this.db.run('DELETE FROM kb_documents WHERE id = ?', [doc.id])
      return true
    })
  }

  listChunks(documentId: string): KbChunkRecord[] {
    return this.db
      .all<ChunkRow>('SELECT * FROM kb_chunks WHERE document_id = ? ORDER BY ordinal ASC', [documentId])
      .map(toChunk)
  }

  /* --------------------------------------------------------- vector layer */

  saveEmbedding(chunkId: string, companyId: string, vector: Float32Array, model: string): void {
    const { blob, norm } = encodeVector(vector)
    this.db.run(
      `INSERT INTO kb_embeddings (chunk_id, company_id, dim, norm, vec, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chunk_id) DO UPDATE SET
         dim = excluded.dim, norm = excluded.norm, vec = excluded.vec, model = excluded.model`,
      [chunkId, companyId, vector.length, norm, blob, model, nowIso()],
    )
  }

  countDocumentEmbeddings(documentId: string, model?: string): number {
    const row = model
      ? this.db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM kb_embeddings e JOIN kb_chunks c ON c.id = e.chunk_id
           WHERE c.document_id = ? AND e.model = ?`,
          [documentId, model],
        )
      : this.db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM kb_embeddings e JOIN kb_chunks c ON c.id = e.chunk_id
           WHERE c.document_id = ?`,
          [documentId],
        )
    return row?.n ?? 0
  }

  countEmbeddings(companyId: string, model?: string): number {
    const row = model
      ? this.db.get<{ n: number }>(
          'SELECT COUNT(*) AS n FROM kb_embeddings WHERE company_id = ? AND model = ?',
          [companyId, model],
        )
      : this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM kb_embeddings WHERE company_id = ?', [companyId])
    return row?.n ?? 0
  }

  /** Top-K by cosine similarity, restricted to readable categories. */
  vectorSearch(
    companyId: string,
    queryVector: Float32Array,
    options: { k: number; categories: readonly string[]; model?: string },
  ): { chunkId: string; score: number }[] {
    if (options.categories.length === 0) return []
    const placeholders = options.categories.map(() => '?').join(', ')
    const params: unknown[] = [companyId, ...options.categories]
    let sql = `SELECT e.chunk_id, e.dim, e.norm, e.vec
                 FROM kb_embeddings e
                 JOIN kb_chunks c ON c.id = e.chunk_id
                 JOIN kb_documents d ON d.id = c.document_id
                WHERE e.company_id = ? AND COALESCE(c.category, d.category) IN (${placeholders})
                  AND NOT EXISTS (SELECT 1 FROM kb_classification_jobs j WHERE j.company_id = c.company_id AND j.document_id = c.document_id AND j.status <> 'ready')`
    if (options.model) {
      sql += ' AND e.model = ?'
      params.push(options.model)
    }
    const rows = this.db.all<EmbeddingRow>(sql, params)
    const scored: { chunkId: string; score: number }[] = []
    for (const row of rows) {
      if (row.dim !== queryVector.length) continue
      const score = cosineSimilarity(queryVector, decodeVector(row.vec, row.dim), row.norm)
      scored.push({ chunkId: row.chunk_id, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, options.k)
  }

  /* -------------------------------------------------------- lexical layer */

  /** Top-K by FTS5 rank, restricted to readable categories. */
  lexicalSearch(
    companyId: string,
    query: string,
    options: { k: number; categories: readonly string[] },
  ): { chunkId: string; rank: number }[] {
    if (options.categories.length === 0) return []
    const match = toFtsQuery(query)
    if (!match) return []
    const placeholders = options.categories.map(() => '?').join(', ')
    try {
      const rows = this.db.all<{ chunk_id: string; rank: number }>(
        `SELECT f.chunk_id AS chunk_id, bm25(kb_chunks_fts) AS rank
           FROM kb_chunks_fts f
           JOIN kb_chunks c ON c.id = f.chunk_id
           JOIN kb_documents d ON d.id = c.document_id
          WHERE kb_chunks_fts MATCH ?
            AND f.company_id = ?
            AND COALESCE(c.category, d.category) IN (${placeholders})
             AND NOT EXISTS (SELECT 1 FROM kb_classification_jobs j WHERE j.company_id = c.company_id AND j.document_id = c.document_id AND j.status <> 'ready')
          ORDER BY rank ASC
          LIMIT ?`,
        [match, companyId, ...options.categories, options.k],
      )
      return rows.map((row) => ({ chunkId: row.chunk_id, rank: row.rank }))
    } catch {
      // A malformed MATCH expression must not fail the whole run; lexical is best-effort.
      return []
    }
  }

  /** Load hit rows with their document provenance, preserving the caller's order. */
  hydrateHits(
    companyId: string,
    scored: readonly { chunkId: string; score: number; lexicalRank?: number | null; vectorRank?: number | null }[],
  ): KbHit[] {
    if (scored.length === 0) return []
    const ids = scored.map((s) => s.chunkId)
    const placeholders = ids.map(() => '?').join(', ')
    const rows = this.db.all<
      ChunkRow & { d_path: string; d_title: string; d_category: string; hit_category: string }
    >(
      `SELECT c.*, d.path AS d_path, d.title AS d_title, d.category AS d_category,
              COALESCE(c.category, d.category) AS hit_category
         FROM kb_chunks c
         JOIN kb_documents d ON d.id = c.document_id
        WHERE c.company_id = ? AND c.id IN (${placeholders})`,
      [companyId, ...ids],
    )
    const byId = new Map(rows.map((row) => [row.id, row]))
    const hits: KbHit[] = []
    for (const item of scored) {
      const row = byId.get(item.chunkId)
      if (!row) continue
      hits.push({
        chunkId: row.id,
        documentId: row.document_id,
        path: row.d_path,
        title: row.d_title,
        category: row.hit_category,
        sectionId: row.section_id ?? null,
        headingPath: row.heading_path,
        headingUrl: row.heading_path ? `#${slugAnchor(row.heading_path)}` : null,
        text: row.text,
        score: item.score,
        lexicalRank: item.lexicalRank ?? null,
        vectorRank: item.vectorRank ?? null,
      })
    }
    return hits
  }

  /* --------------------------------------------------------- index jobs */

  startIndexJob(companyId: string, documentId: string | null): string {
    const id = newId()
    this.db.run(
      `INSERT INTO kb_index_jobs (id, company_id, document_id, status, chunks, started_at)
       VALUES (?, ?, ?, 'pending', 0, ?)`,
      [id, companyId, documentId, nowIso()],
    )
    return id
  }

  finishIndexJob(
    id: string,
    status: KbIndexStatus,
    details: { chunks?: number; error?: string | null } = {},
  ): void {
    this.db.run(
      `UPDATE kb_index_jobs SET status = ?, chunks = ?, error = ?, finished_at = ? WHERE id = ?`,
      [status, details.chunks ?? 0, details.error ?? null, nowIso(), id],
    )
  }

  listIndexJobs(companyId: string, limit = 20): {
    id: string
    documentId: string | null
    status: string
    chunks: number
    error: string | null
    startedAt: string
    finishedAt: string | null
  }[] {
    return this.db
      .all<{
        id: string
        document_id: string | null
        status: string
        chunks: number
        error: string | null
        started_at: string
        finished_at: string | null
      }>(
        `SELECT id, document_id, status, chunks, error, started_at, finished_at
           FROM kb_index_jobs WHERE company_id = ? ORDER BY started_at DESC LIMIT ?`,
        [companyId, limit],
      )
      .map((row) => ({
        id: row.id,
        documentId: row.document_id,
        status: row.status,
        chunks: row.chunks,
        error: row.error,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
      }))
  }

  stats(companyId: string): { documents: number; chunks: number; embedded: number; categories: number } {
    const documents = this.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM kb_documents WHERE company_id = ?',
      [companyId],
    )
    const chunks = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM kb_chunks WHERE company_id = ?', [companyId])
    const embedded = this.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM kb_embeddings WHERE company_id = ?',
      [companyId],
    )
    const categories = this.db.get<{ n: number }>(
      'SELECT COUNT(DISTINCT category) AS n FROM kb_documents WHERE company_id = ?',
      [companyId],
    )
    return {
      documents: documents?.n ?? 0,
      chunks: chunks?.n ?? 0,
      embedded: embedded?.n ?? 0,
      categories: categories?.n ?? 0,
    }
  }
}

/** Anchor link mirroring the GitHub heading slug so agents can cite a section. */
export function slugAnchor(heading: string): string {
  return heading
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

/**
 * Build a safe FTS5 MATCH expression: quote each term so punctuation in a user
 * question cannot be parsed as FTS syntax, and OR the terms so partial matches
 * still return candidates.
 */
export function toFtsQuery(query: string): string | null {
  const terms = query
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 12)
  if (terms.length === 0) return null
  return terms.map((t) => `"${t.replaceAll('"', '')}"`).join(' OR ')
}

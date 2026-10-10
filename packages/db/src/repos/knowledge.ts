/** Knowledge documents, chunks, embeddings, and ACL-filtered retrieval. */
import {
  newId,
  nowIso,
  sha256,
  type KbChunkRecord,
  type KbDocumentRecord,
  type KbHit,
  type KbIndexStatus,
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
}

interface ChunkRow {
  id: string
  document_id: string
  company_id: string
  ordinal: number
  text: string
  heading_path: string | null
  tokens: number
}

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
})

const toChunk = (row: ChunkRow): KbChunkRecord => ({
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
                  mtime = @mtime, version = @version, source = @source, updated_at = @updatedAt
            WHERE id = @id`,
          {
            id,
            title: input.title,
            category: input.category,
            tags: JSON.stringify(input.tags),
            checksum,
            mtime: input.mtime ?? null,
            version,
            source: input.source ?? existing.source,
            updatedAt: now,
          },
        )
      } else {
        this.db.run(
          `INSERT INTO kb_documents
             (id, company_id, path, title, category, tags_json, checksum, mtime, version, source, created_by, created_at, updated_at)
           VALUES (@id, @companyId, @path, @title, @category, @tags, @checksum, @mtime, @version, @source, @userId, @createdAt, @updatedAt)`,
          {
            id,
            companyId: input.companyId,
            path: input.path,
            title: input.title,
            category: input.category,
            tags: JSON.stringify(input.tags),
            checksum,
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
        `INSERT INTO kb_chunks (id, document_id, company_id, ordinal, text, heading_path, tokens)
         VALUES (@id, @documentId, @companyId, @ordinal, @text, @headingPath, @tokens)`,
        {
          id,
          documentId,
          companyId,
          ordinal: chunk.ordinal,
          text: chunk.text,
          headingPath: chunk.headingPath,
          tokens: chunk.tokens,
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
                WHERE e.company_id = ? AND d.category IN (${placeholders})`
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
            AND d.category IN (${placeholders})
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
      ChunkRow & { d_path: string; d_title: string; d_category: string }
    >(
      `SELECT c.*, d.path AS d_path, d.title AS d_title, d.category AS d_category
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
        category: row.d_category,
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

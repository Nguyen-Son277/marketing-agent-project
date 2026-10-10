/**
 * Float32 vector helpers.
 *
 * Embeddings are stored as raw little-endian float32 BLOBs in SQLite. At the
 * scale this system targets (tens of thousands of chunks per company) a full
 * scan with early-continue on dimension mismatch is a few tens of milliseconds,
 * which beats maintaining an ANN index. `package.json` records the measured
 * threshold at which this should become a vector extension instead.
 */

/** Pack a vector into a BLOB plus its L2 norm, so cosine needs no second pass. */
export function encodeVector(vector: Float32Array): { blob: Buffer; norm: number } {
  const blob = Buffer.allocUnsafe(vector.length * 4)
  let sumSquares = 0
  for (let i = 0; i < vector.length; i++) {
    const value = vector[i] ?? 0
    sumSquares += value * value
    blob.writeFloatLE(value, i * 4)
  }
  return { blob, norm: Math.sqrt(sumSquares) }
}

/** Unpack a stored vector. `expectedDim` from the row guards corrupt payloads. */
export function decodeVector(blob: Buffer, expectedDim: number): Float32Array {
  const available = Math.floor(blob.byteLength / 4)
  const dim = expectedDim > 0 ? Math.min(expectedDim, available) : available
  const out = new Float32Array(dim)
  for (let i = 0; i < dim; i++) out[i] = blob.readFloatLE(i * 4)
  return out
}

/**
 * Cosine similarity between a query vector and a stored vector whose precomputed
 * norm is supplied, avoiding a second pass over the stored payload.
 */
export function cosineSimilarity(query: Float32Array, stored: Float32Array, storedNorm: number): number {
  const n = Math.min(query.length, stored.length)
  if (n === 0) return 0
  let dot = 0
  let querySquares = 0
  for (let i = 0; i < n; i++) {
    const q = query[i] ?? 0
    dot += q * (stored[i] ?? 0)
    querySquares += q * q
  }
  const queryNorm = Math.sqrt(querySquares)
  const denominator = queryNorm * storedNorm
  return denominator === 0 ? 0 : dot / denominator
}

/** L2-normalize in place-free fashion; used before storing a vector. */
export function normalizeVector(vector: Float32Array): Float32Array {
  let sumSquares = 0
  for (let i = 0; i < vector.length; i++) sumSquares += (vector[i] ?? 0) ** 2
  const norm = Math.sqrt(sumSquares)
  if (norm === 0) return vector
  const out = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i++) out[i] = (vector[i] ?? 0) / norm
  return out
}

/** Mean of several vectors, used to embed a multi-sentence query cheaply. */
export function meanVector(vectors: readonly Float32Array[]): Float32Array {
  if (vectors.length === 0) return new Float32Array(0)
  const dim = vectors[0]?.length ?? 0
  const out = new Float32Array(dim)
  for (const vector of vectors) {
    for (let i = 0; i < Math.min(dim, vector.length); i++) out[i] = (out[i] ?? 0) + (vector[i] ?? 0)
  }
  for (let i = 0; i < dim; i++) out[i] = (out[i] ?? 0) / vectors.length
  return out
}

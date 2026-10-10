/**
 * Tiện ích thuần, không phụ thuộc Node.
 *
 * Vì sao phải thuần: giao diện web dùng chung module này. Bất kỳ import `node:*`
 * nào ở đây cũng làm hỏng bundle trình duyệt — các hàm cần `node:crypto` nằm ở
 * `crypto-util.ts` và chỉ phía server import.
 */

export const nowIso = (): string => new Date().toISOString()

/** URL/folder-safe slug for a Vietnamese or ASCII label. */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/** Clamp a number into an inclusive range. */
export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** Rough token estimate (~4 chars/token) used for budgeting before a real count exists. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

/** Truncate text on a word boundary, appending an ellipsis when cut. */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const lastSpace = cut.lastIndexOf(' ')
  return `${lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut}…`
}

/** Group array items by a derived key, preserving insertion order of items. */
export function groupBy<T, K extends string>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const bucket = out.get(k)
    if (bucket) bucket.push(item)
    else out.set(k, [item])
  }
  return out
}

/** Round to `decimals` places without float drift surprises. */
export const round = (value: number, decimals = 6): number => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** Promise-based sleep; used by retry backoff. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** Retry with exponential backoff and jitter. Returns the last error if all attempts fail. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number; maxDelayMs?: number; isRetryable?: (e: unknown) => boolean } = {},
): Promise<T> {
  const { attempts = 3, baseDelayMs = 300, maxDelayMs = 8_000, isRetryable = () => true } = options
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (error) {
      lastError = error
      if (attempt === attempts || !isRetryable(error)) break
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
      await sleep(delay + Math.floor(Math.random() * 100))
    }
  }
  throw lastError
}

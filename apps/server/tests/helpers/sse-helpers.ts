import type { WorkflowStreamEnvelope } from '@marketing-agent/shared'
import { vi } from 'vitest'
import type { EventBus } from '../../src/context.ts'

export interface CollectedSseEvent {
  readonly event: string
  readonly id?: string
  readonly data: WorkflowStreamEnvelope
}

interface Waiter {
  predicate: (event: CollectedSseEvent) => boolean
  resolve: (event: CollectedSseEvent) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** Raw fetch, one continuous reader, and event-driven waits (never polling). */
export async function collectSse(
  url: string,
  headers: Record<string, string>,
  options: { timeoutMs?: number; events?: EventBus } = {},
) {
  let subscribed = false
  const unsubscribed = deferred()
  const subscribe = options.events?.subscribe.bind(options.events)
  const subscribeSpy = options.events ? vi.spyOn(options.events, 'subscribe').mockImplementation((companyId, listener) => {
    subscribed = true
    const unsubscribe = subscribe!(companyId, listener)
    return () => { unsubscribe(); unsubscribed.resolve() }
  }) : undefined
  const controller = new AbortController()
  const events: CollectedSseEvent[] = []
  const waiters = new Set<Waiter>()
  let closed = false
  let failure: Error | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let pump: Promise<void> = Promise.resolve()

  function rejectWaiters(error: Error) {
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    waiters.clear()
  }

  async function close() {
    if (!closed) {
      closed = true
      clearTimeout(lifetime)
      rejectWaiters(failure ?? new Error('SSE collector closed'))
      controller.abort()
      await reader?.cancel().catch(() => {})
    }
    await pump
    // Wait on the real server's unsubscribe callback, not elapsed-time guesses.
    if (subscribed) await withTimeout(unsubscribed.promise, 'SSE subscriber cleanup')
  }

  const lifetime = setTimeout(() => {
    failure = new Error(`SSE collection timed out after ${options.timeoutMs ?? 15_000} ms`)
    void close().catch(() => {})
  }, options.timeoutMs ?? 15_000)

  let response: Response
  try {
    response = await fetch(url, { headers, signal: controller.signal })
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
      throw new Error(`Expected SSE response, got HTTP ${response.status}`)
    }
    reader = response.body.getReader()
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error))
    await close()
    throw failure
  } finally {
    subscribeSpy?.mockRestore()
  }

  function consume(frame: string) {
    let event = 'message'
    let id: string | undefined
    const data: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue
      const separator = line.indexOf(':')
      const field = separator === -1 ? line : line.slice(0, separator)
      const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '')
      if (field === 'event') event = value
      else if (field === 'id') id = value
      else if (field === 'data') data.push(value)
    }
    if (data.length === 0) return
    const item: CollectedSseEvent = { event, ...(id === undefined ? {} : { id }), data: JSON.parse(data.join('\n')) as WorkflowStreamEnvelope }
    events.push(item)
    for (const waiter of waiters) {
      if (!waiter.predicate(item)) continue
      clearTimeout(waiter.timer)
      waiters.delete(waiter)
      waiter.resolve(item)
    }
  }

  pump = (async () => {
    const decoder = new TextDecoder()
    let pending = ''
    try {
      while (!closed) {
        const chunk = await reader!.read()
        if (chunk.done) break
        pending += decoder.decode(chunk.value, { stream: true })
        // Normalize complete CRLF pairs; retain partial frames across reads.
        pending = pending.replace(/\r\n/g, '\n')
        let boundary: number
        while ((boundary = pending.indexOf('\n\n')) !== -1) {
          consume(pending.slice(0, boundary))
          pending = pending.slice(boundary + 2)
        }
      }
      if (!closed) {
        failure = new Error('SSE stream ended before collector closed')
        rejectWaiters(failure)
      }
    } catch (error) {
      if (!closed) {
        failure = error instanceof Error ? error : new Error(String(error))
        rejectWaiters(failure)
        controller.abort()
      }
    } finally {
      reader!.releaseLock()
    }
  })()

  return {
    response,
    events,
    close,
    waitFor(predicate: (event: CollectedSseEvent) => boolean, timeoutMs = 4_000): Promise<CollectedSseEvent> {
      const existing = events.find(predicate)
      if (existing) return Promise.resolve(existing)
      if (closed || failure) return Promise.reject(failure ?? new Error('SSE collector closed'))
      return new Promise((resolve, reject) => {
        const waiter: Waiter = {
          predicate, resolve, reject,
          timer: setTimeout(() => {
            waiters.delete(waiter)
            const error = new Error(`SSE event wait timed out after ${timeoutMs} ms; received: ${events.map((item) => item.event).join(', ')}`)
            reject(error)
            failure = error
            void close().catch(() => {})
          }, timeoutMs),
        }
        waiters.add(waiter)
      })
    },
  }
}

export type SseCollector = Awaited<ReturnType<typeof collectSse>>

/** A deterministic asynchronous gate for an adapter/tool; no sleeps or busy polls. */
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

/** Bound gate waits too, so broken runtime wiring cannot hang teardown. */
export async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 4_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

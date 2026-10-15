import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRefreshCoordinator } from '../src/lib/workflow-refresh.ts'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve() }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('workflow refresh coordinator', () => {
  it('coalesces a burst into one refresh after 200ms', async () => {
    const run = vi.fn(async () => {})
    const coordinator = createRefreshCoordinator({ run })
    for (let index = 0; index < 30; index++) coordinator.request()
    await vi.advanceTimersByTimeAsync(199)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
    coordinator.dispose()
  })

  it('never overlaps requests and follows an in-flight burst exactly once', async () => {
    const first = deferred()
    const second = deferred()
    let active = 0
    let maxActive = 0
    const run = vi.fn(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await (run.mock.calls.length === 1 ? first.promise : second.promise)
      active--
    })
    const coordinator = createRefreshCoordinator({ run })
    coordinator.request(true)
    await flush()
    for (let index = 0; index < 50; index++) coordinator.request(index % 2 === 0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(1)
    first.resolve()
    await flush()
    await vi.advanceTimersByTimeAsync(199)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)
    expect(maxActive).toBe(1)
    second.resolve()
    await flush()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(run).toHaveBeenCalledTimes(2)
    coordinator.dispose()
  })

  it('handles the timer/in-flight completion race without losing invalidation', async () => {
    const first = deferred()
    const run = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined)
    const coordinator = createRefreshCoordinator({ run })
    coordinator.request()
    await vi.advanceTimersByTimeAsync(200)
    first.resolve()
    coordinator.request()
    await flush()
    await vi.advanceTimersByTimeAsync(200)
    expect(run).toHaveBeenCalledTimes(2)
    coordinator.dispose()
  })

  it('settles a rejected refresh and can retry', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const coordinator = createRefreshCoordinator({ run })
    coordinator.request(true)
    await flush()
    coordinator.request(true)
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
    coordinator.dispose()
  })

  it('pauses hidden-page timers and refreshes immediately when visible', async () => {
    const run = vi.fn(async () => {})
    const coordinator = createRefreshCoordinator({ run })
    coordinator.request()
    coordinator.setPaused(true)
    await vi.advanceTimersByTimeAsync(10_000)
    coordinator.request(true)
    expect(run).not.toHaveBeenCalled()
    coordinator.setPaused(false)
    await flush()
    expect(run).toHaveBeenCalledTimes(1)
    coordinator.dispose()
  })

  it('aborts in-flight work and cancels dirty followup on cleanup', async () => {
    const first = deferred()
    const run = vi.fn((_signal: AbortSignal) => first.promise)
    const coordinator = createRefreshCoordinator({ run })
    coordinator.request(true)
    await flush()
    coordinator.request()
    coordinator.dispose()
    expect(run.mock.calls[0]?.[0].aborted).toBe(true)
    first.resolve()
    await flush()
    await vi.advanceTimersByTimeAsync(10_000)
    coordinator.request(true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels work before the initial microtask and pending burst timer', async () => {
    const run = vi.fn(async () => {})
    const immediate = createRefreshCoordinator({ run })
    immediate.request(true)
    immediate.dispose()
    const delayed = createRefreshCoordinator({ run })
    delayed.request()
    delayed.dispose()
    await flush()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(run).not.toHaveBeenCalled()
  })
})

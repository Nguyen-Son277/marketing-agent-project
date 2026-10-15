/** Single-flight invalidation coordinator, independent of React and the transport. */
export interface RefreshCoordinator {
  request: (immediate?: boolean) => void
  setPaused: (paused: boolean) => void
  dispose: () => void
}

export function createRefreshCoordinator(options: {
  run: (signal: AbortSignal) => Promise<void>
  delayMs?: number
}): RefreshCoordinator {
  const delay = options.delayMs ?? 200
  let disposed = false
  let paused = false
  let dirty = false
  let inFlight = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const start = () => {
    clearTimer()
    if (disposed || paused || inFlight) return
    dirty = false
    inFlight = true
    const requestController = new AbortController()
    controller = requestController
    // The caller owns error presentation. Always settle the slot, even on rejection.
    void Promise.resolve().then(() => {
      if (!disposed) return options.run(requestController.signal)
    }).catch(() => {}).finally(() => {
      if (controller === requestController) controller = undefined
      inFlight = false
      if (dirty && !disposed && !paused) schedule()
    })
  }
  const schedule = () => {
    if (timer === undefined && !disposed && !paused && !inFlight) timer = setTimeout(start, delay)
  }
  return {
    request(immediate = false) {
      if (disposed) return
      dirty = true
      if (paused || inFlight) return
      if (immediate) start()
      else schedule()
    },
    setPaused(value) {
      if (disposed || value === paused) return
      paused = value
      if (paused) clearTimer()
      else this.request(true)
    },
    dispose() {
      disposed = true
      dirty = false
      clearTimer()
      controller?.abort()
    },
  }
}

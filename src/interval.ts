// A stopped countdown cannot schedule another shot, even when capture is still in flight.
export class IntervalTimer {
  private timer: ReturnType<typeof setTimeout> | null = null
  private run: AbortController | null = null

  start(seconds: number, onTick: (remaining: number) => void, onShot: (signal: AbortSignal) => Promise<void>): AbortSignal {
    if (!Number.isInteger(seconds) || seconds < 1) throw new Error('Invalid interval')
    this.stop()
    const run = new AbortController()
    this.run = run
    const cycle = () => {
      if (run.signal.aborted) return
      let remaining = seconds
      onTick(remaining)
      const tick = async () => {
        if (run.signal.aborted) return
        onTick(--remaining)
        if (remaining === 0) {
          try { await onShot(run.signal) }
          finally { if (!run.signal.aborted) cycle() }
        } else {
          this.timer = setTimeout(tick, 1000)
        }
      }
      this.timer = setTimeout(tick, 1000)
    }
    cycle()
    return run.signal
  }

  stop() {
    this.run?.abort()
    this.run = null
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { IntervalTimer } from '../src/interval'
afterEach(() => vi.useRealTimers())
describe('interval cancellation', () => {
  it('stops immediately during the countdown and never takes a shot', async () => {
    vi.useFakeTimers()
    const timer = new IntervalTimer(), onShot = vi.fn(async () => {})
    const ticks: number[] = []
    const signal = timer.start(3, n => ticks.push(n), onShot)
    await vi.advanceTimersByTimeAsync(1000)
    timer.stop()
    await vi.advanceTimersByTimeAsync(10000)
    expect(signal.aborted).toBe(true)
    expect(ticks).toEqual([3, 2])
    expect(onShot).not.toHaveBeenCalled()
  })
  it('aborts an in-flight shot and does not schedule the next countdown', async () => {
    vi.useFakeTimers()
    const timer = new IntervalTimer(), ticks: number[] = []
    let finish!: () => void
    const onShot = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const signal = timer.start(1, n => ticks.push(n), onShot)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onShot).toHaveBeenCalledTimes(1)
    timer.stop()
    finish()
    await vi.advanceTimersByTimeAsync(10000)
    expect(signal.aborted).toBe(true)
    expect(onShot).toHaveBeenCalledTimes(1)
    expect(ticks).toEqual([1, 0])
  })
})

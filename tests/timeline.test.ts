import { describe, it, expect } from 'vitest'
import { timeline, exportPlan, reorder, remove } from '../src/timeline'
const frame = (id: string, hold: number) => ({ id, hold, width: 320, height: 240 })
describe('shared timeline', () => {
  it('keeps held frames as one encoded sample with precise presentation timestamps', () => {
    const frames = [frame('a', 2), frame('b', 3), frame('c', 1)]
    expect(timeline(frames, 12)).toEqual({ durationFrames: 6, durationSeconds: .5, timestampPerFrame: [0, 2/12, 5/12] })
    expect(exportPlan(frames, 12)).toEqual([{ index: 0, timestamp: 0, duration: 166667 }, { index: 1, timestamp: 166667, duration: 250000 }, { index: 2, timestamp: 416667, duration: 83333 }])
  })
  it('derives duration from selected fps, including one frame', () => {
    const frames = Array.from({ length: 84 }, (_, i) => frame(String(i), 1))
    expect(timeline(frames, 12).durationSeconds.toFixed(1)).toBe('7.0')
    expect(timeline(frames, 24).durationSeconds.toFixed(1)).toBe('3.5')
    expect(timeline([frame('only', 3)], 6)).toEqual({ durationFrames: 3, durationSeconds: .5, timestampPerFrame: [0] })
    expect(timeline([], 6).durationSeconds).toBe(0)
  })
  it('reorders with holds attached and restores prior order and holds', () => {
    const before = [frame('a', 3), frame('b', 1), frame('c', 9)]
    const after = reorder(before, 0, 2)
    expect(after.map(f => [f.id, f.hold])).toEqual([['b', 1], ['c', 9], ['a', 3]])
    expect(before.map(f => [f.id, f.hold])).toEqual([['a', 3], ['b', 1], ['c', 9]])
    expect(reorder(after, 2, 0)).toEqual(before)
  })
  it('delete and undo restores the same index, not the end', () => {
    const before = [frame('a', 1), frame('b', 7), frame('c', 2)]
    const after = remove(before, 1)
    expect(after).toEqual([before[0], before[2]])
    after.splice(1, 0, before[1]); expect(after).toEqual(before)
  })
})

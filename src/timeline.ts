export interface Frame { id: string; hold: number; width: number; height: number }
export interface Timing { durationFrames: number; durationSeconds: number; timestampPerFrame: number[] }
export function timeline(frames: readonly Pick<Frame, 'hold'>[], fps: number): Timing {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('Invalid fps')
  let ticks = 0
  const timestampPerFrame = frames.map(frame => {
    if (!Number.isInteger(frame.hold) || frame.hold < 1 || frame.hold > 9) throw new Error('Invalid hold')
    const start = ticks / fps
    ticks += frame.hold
    return start
  })
  return { durationFrames: ticks, durationSeconds: ticks / fps, timestampPerFrame }
}
export function exportPlan(frames: readonly Pick<Frame, 'hold'>[], fps: number) {
  const t = timeline(frames, fps)
  return frames.map((frame, i) => ({ index: i, timestamp: Math.round(t.timestampPerFrame[i] * 1_000_000), duration: Math.round(frame.hold / fps * 1_000_000) }))
}
export function reorder<T>(items: readonly T[], from: number, to: number): T[] {
  const copy = [...items]; if (from < 0 || from >= copy.length || to < 0 || to >= copy.length) return copy
  copy.splice(to, 0, copy.splice(from, 1)[0]); return copy
}
export function remove<T>(items: readonly T[], index: number): T[] { return items.filter((_, i) => i !== index) }

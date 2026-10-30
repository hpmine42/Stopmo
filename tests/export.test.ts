import { it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { unzipSync } from 'fflate'
import { framesZip } from '../src/export'
import { store } from '../src/store'
beforeEach(async () => { await store.clear() })
it('exports numbered JPEGs with their holds and exact timeline metadata', async () => {
  const frames = [
    { id: 'a', hold: 2, width: 32, height: 32 },
    { id: 'b', hold: 3, width: 32, height: 32 }
  ]
  for (const f of frames) await store.put({ ...f, blob: new Blob([`jpeg-${f.id}`]), thumb: new Blob(['thumb']) })
  const progress: number[] = []
  const zipped = await framesZip(frames, 12, new AbortController().signal, n => progress.push(n))
  const files = unzipSync(new Uint8Array(await zipped.arrayBuffer()))
  expect(Object.keys(files)).toEqual(['frame_0001_hold2.jpg', 'frame_0002_hold3.jpg', 'timeline.txt'])
  expect(new TextDecoder().decode(files['frame_0001_hold2.jpg'])).toBe('jpeg-a')
  expect(new TextDecoder().decode(files['timeline.txt'])).toContain('fps: 12\nframes: 2\nduration: 0.4 s')
  expect(progress).toEqual([.5, 1])
})

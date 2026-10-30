import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { store } from '../src/store'
beforeEach(async () => { await store.clear() })
describe('project storage', () => {
  it('round-trips JPEG blobs, order and holds and deletes every record', async () => {
    const frame = { id: 'one', hold: 4, width: 20, height: 10, blob: new Blob(['jpeg bytes'], { type: 'image/jpeg' }), thumb: new Blob(['thumb'], { type: 'image/jpeg' }) }
    await store.put(frame); await store.save([frame], 8)
    expect(await (await store.get('one'))?.blob.text()).toBe('jpeg bytes')
    expect(await (await store.get('one'))?.thumb.text()).toBe('thumb')
    expect((await store.load())?.order[0].hold).toBe(4)
    await store.clear()
    expect(await store.list()).toEqual([]); expect(await store.load()).toBeUndefined()
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { store } from '../src/store'
import { reactive } from 'vue'
beforeEach(async () => { await store.clear() })
describe('project storage', () => {
  it('round-trips JPEG blobs, order and holds and deletes every record', async () => {
    const frame = { id: 'one', hold: 4, width: 20, height: 10, blob: new Blob(['jpeg bytes'], { type: 'image/jpeg' }), thumb: new Blob(['thumb'], { type: 'image/jpeg' }) }
    await store.put(frame); await store.save([frame], 8)
    expect(await (await store.get('one'))?.blob.text()).toBe('jpeg bytes')
    expect(await (await store.get('one'))?.thumb.text()).toBe('thumb')
    expect((await store.load())?.order[0].hold).toBe(4)
    await store.clear()
    expect(await store.list()).toEqual([]); expect(await store.ids()).toEqual([]); expect(await store.load()).toBeUndefined()
  })
})

it('stores a camera frame and the reactive Vue timeline without DataCloneError', async () => {
  const frame = reactive({ id: 'camera-1', hold: 2, width: 640, height: 480, blob: new Blob(['photo'], { type: 'image/jpeg' }), thumb: new Blob(['preview'], { type: 'image/jpeg' }) })
  const order = reactive([frame])
  // Vue proxies cannot be passed directly to IDBObjectStore.put.
  expect(() => structuredClone(order)).toThrow()
  await store.put(frame)
  await store.save(order, 12)
  expect((await store.load())?.order).toEqual([{ id: 'camera-1', hold: 2, width: 640, height: 480 }])
  expect(await (await store.get('camera-1'))?.blob.text()).toBe('photo')
  order[0].hold = 3
  await store.save(order, 8)
  expect((await store.load())?.order[0].hold).toBe(3)
  expect((await store.load())?.fps).toBe(8)
})

it('can discover orphaned photos from a failed timeline save', async () => {
  await store.put({ id: 'orphan', hold: 1, width: 320, height: 240, blob: new Blob(['photo']), thumb: new Blob(['thumb']) })
  expect(await store.load()).toBeUndefined()
  expect(await store.ids()).toEqual(['orphan'])
  const recovered = await store.get('orphan')
  expect(await recovered?.blob.text()).toBe('photo')
  await store.save([{ id: recovered!.id, hold: recovered!.hold, width: recovered!.width, height: recovered!.height }], 12)
  expect((await store.load())?.order[0].id).toBe('orphan')
})

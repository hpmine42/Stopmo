import type { Frame } from './timeline'
const NAME = 'stopmo'; const VERSION = 1
export interface StoredFrame extends Frame { blob: Blob; thumb: Blob }
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, VERSION)
    request.onupgradeneeded = () => { const database = request.result; database.createObjectStore('frames', { keyPath: 'id' }); database.createObjectStore('project') }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function transact<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction, done: (value: T) => void) => void): Promise<T> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const tx = database.transaction(stores, mode); let result: T
    tx.oncomplete = () => { database.close(); resolve(result) }; tx.onerror = () => { database.close(); reject(tx.error) }; tx.onabort = () => { database.close(); reject(tx.error) }
    work(tx, value => { result = value })
  })
}
export const store = {
  put(frame: StoredFrame) {
    // IndexedDB cannot clone Vue's reactive proxies. Only pass plain records and blobs.
    const record: StoredFrame = { id: frame.id, hold: frame.hold, width: frame.width, height: frame.height, blob: frame.blob, thumb: frame.thumb }
    return transact<void>(['frames'], 'readwrite', tx => { tx.objectStore('frames').put(record) })
  },
  get(id: string) { return transact<StoredFrame | undefined>(['frames'], 'readonly', (tx, done) => { const r = tx.objectStore('frames').get(id); r.onsuccess = () => done(r.result) }) },
  list() { return transact<StoredFrame[]>(['frames'], 'readonly', (tx, done) => { const r = tx.objectStore('frames').getAll(); r.onsuccess = () => done(r.result) }) },
  ids() { return transact<string[]>(['frames'], 'readonly', (tx, done) => { const r = tx.objectStore('frames').getAllKeys(); r.onsuccess = () => done(r.result as string[]) }) },
  save(order: readonly Frame[], fps: number) {
    const snapshot = order.map(frame => ({ id: frame.id, hold: frame.hold, width: frame.width, height: frame.height }))
    return transact<void>(['project'], 'readwrite', tx => { tx.objectStore('project').put({ order: snapshot, fps }, 'current') })
  },
  load() { return transact<{ order: Frame[]; fps: number } | undefined>(['project'], 'readonly', (tx, done) => { const r = tx.objectStore('project').get('current'); r.onsuccess = () => done(r.result) }) },
  deleteFrame(id: string) { return transact<void>(['frames'], 'readwrite', tx => { tx.objectStore('frames').delete(id) }) },
  clear() { return transact<void>(['frames', 'project'], 'readwrite', tx => { tx.objectStore('frames').clear(); tx.objectStore('project').clear() }) }
}

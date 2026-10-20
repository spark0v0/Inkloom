import type { JSONContent } from '@tiptap/core'

export type RecoveryDraft = {
  key: string; baseVersion: string; text: string; doc: JSONContent; updatedAt: string
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('story-workshop-recovery', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function operation<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('drafts', mode)
    const request = run(transaction.objectStore('drafts'))
    let value: T
    request.onsuccess = () => { value = request.result }
    transaction.oncomplete = () => { db.close(); resolve(value) }
    transaction.onerror = () => { db.close(); reject(transaction.error) }
    transaction.onabort = () => { db.close(); reject(transaction.error) }
  })
}

export const drafts = {
  get: (key: string) => operation<RecoveryDraft | undefined>('readonly', store => store.get(key)),
  put: (draft: RecoveryDraft) => operation('readwrite', store => store.put(draft)),
  remove: (key: string) => operation('readwrite', store => store.delete(key)),
}

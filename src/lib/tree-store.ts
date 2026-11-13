import type { SequenceType } from '../types/cmaple'

const DB_NAME = 'syrup'
const DB_VERSION = 1
const STORE_NAME = 'trees'
const SAVED_AT_INDEX = 'savedAt'

export const MAX_SAVED_TREES = 50
export const TREES_CHANGED_CHANNEL = 'syrup-trees'

const MAX_QUOTA_RETRIES = 5

export interface StoredTree {
  id: string
  savedAt: number
  name: string
  sourceFileName: string
  newick: string
  nexus: string
  maple: string
  logLikelihood: number
  sampleCount: number
  sequenceLength: number
  sequenceType: SequenceType
  sizeBytes: number
}

export type TreeToSave = Omit<StoredTree, 'id' | 'savedAt' | 'sizeBytes'>

let databasePromise: Promise<IDBDatabase> | null = null
let changeChannel: BroadcastChannel | null = null

function connectDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex(SAVED_AT_INDEX, 'savedAt')
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the tree library.'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise

  const pending = connectDatabase().catch((error: unknown) => {
    databasePromise = null
    throw error
  })
  databasePromise = pending
  return pending
}

function isQuotaExceeded(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)
}

// Resolves once the record is committed and the store is back inside the cap.
function writeTree(database: IDBDatabase, record: StoredTree): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('The tree could not be saved.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('The tree could not be saved.'))

    const addRequest = store.add(record)
    addRequest.onerror = () => reject(addRequest.error ?? new Error('The tree could not be saved.'))

    const countRequest = store.count()
    countRequest.onsuccess = () => {
      let excess = countRequest.result - MAX_SAVED_TREES
      if (excess <= 0) return

      const cursorRequest = store.index(SAVED_AT_INDEX).openCursor()
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (!cursor || excess <= 0) return
        store.delete(cursor.primaryKey)
        excess -= 1
        cursor.continue()
      }
    }
  })
}

function deleteOldestTree(database: IDBDatabase): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    let removed = false

    transaction.oncomplete = () => resolve(removed)
    transaction.onabort = () => reject(transaction.error ?? new Error('The oldest tree could not be removed.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('The oldest tree could not be removed.'))

    const cursorRequest = store.index(SAVED_AT_INDEX).openCursor()
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) return
      store.delete(cursor.primaryKey)
      removed = true
    }
  })
}

function announceChange() {
  if (typeof BroadcastChannel === 'undefined') return
  if (!changeChannel) changeChannel = new BroadcastChannel(TREES_CHANGED_CHANNEL)
  changeChannel.postMessage({ type: 'trees-changed' })
}

export async function saveTree(tree: TreeToSave): Promise<void> {
  try {
    const database = await openDatabase()
    const record: StoredTree = {
      ...tree,
      id: crypto.randomUUID(),
      savedAt: Date.now(),
      sizeBytes: new Blob([tree.newick]).size,
    }

    for (let attempt = 0; attempt <= MAX_QUOTA_RETRIES; attempt += 1) {
      try {
        await writeTree(database, record)
        announceChange()
        return
      } catch (error) {
        if (!isQuotaExceeded(error)) throw error
        const removed = await deleteOldestTree(database)
        if (!removed) throw error
      }
    }
  } catch (error) {
    console.warn('[syrup] could not save tree', error)
  }
}

export async function listTrees(): Promise<StoredTree[]> {
  const database = await openDatabase()

  return new Promise<StoredTree[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).getAll()

    request.onsuccess = () => {
      const trees = request.result as StoredTree[]
      resolve(trees.sort((left, right) => right.savedAt - left.savedAt))
    }

    request.onerror = () => reject(request.error ?? new Error('The tree library could not be read.'))
  })
}

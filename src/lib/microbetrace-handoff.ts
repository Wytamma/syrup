const DATABASE_NAME = 'microbetrace-partner-export'
const DATABASE_VERSION = 1
const STORE_NAME = 'handoffs'
const HANDOFF_TTL_MS = 5 * 60 * 1000

type MicrobeTraceWindow = Pick<Window, 'close' | 'location'>

type MicrobeTraceFile = {
  name: string
  kind: 'maple' | 'newick'
  mimeType: string
  contents: string
}

export type MicrobeTraceOptions = {
  partnerId: string
  target: string
  files: MicrobeTraceFile[]
  metadata: {
    datasetName: string
    sourceApp: string
  }
  launch: {
    datasetName: string
    defaultView: 'Phylogenetic Tree'
  }
}

type HandoffRecord = {
  id: string
  version: 1
  createdAt: number
  expiresAt: number
  options: MicrobeTraceOptions
}

export type MicrobeTraceExport = {
  fileName: string
  maple: string
  newick: string
}

type MicrobeTraceEmbedApi = {
  open(options: MicrobeTraceOptions): Promise<unknown>
}

declare global {
  interface Window {
    MicrobeTraceEmbed?: MicrobeTraceEmbedApi
  }
}

export function getMicrobeTraceConfig(location: Pick<Location, 'hostname'> = window.location) {
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  return isLocal
    ? { partnerId: 'local-dev', target: 'http://localhost:4200/' }
    : { partnerId: 'syrup', target: 'https://microbetrace.cdc.gov/MicrobeTrace/' }
}

export function openMicrobeTraceBridgeWindow() {
  return window.open('about:blank', '_blank', 'popup=yes,width=960,height=720')
}

export async function stageMicrobeTraceExport(
  input: MicrobeTraceExport,
  bridgeWindow: MicrobeTraceWindow,
) {
  const id = crypto.randomUUID()
  const now = Date.now()
  const record: HandoffRecord = {
    id,
    version: 1,
    createdAt: now,
    expiresAt: now + HANDOFF_TTL_MS,
    options: buildOptions(input),
  }

  await storeRecord(record)

  const bridgeUrl = new URL('trees.html', document.baseURI)
  bridgeUrl.hash = `handoff=${encodeURIComponent(id)}`
  bridgeWindow.location.replace(bridgeUrl.toString())
  return id
}

function buildOptions(input: MicrobeTraceExport): MicrobeTraceOptions {
  const { partnerId, target } = getMicrobeTraceConfig()
  const baseName = input.fileName.replace(/\.[^.]+$/, '') || 'syrup-analysis'
  const datasetName = `${baseName} — Syrup analysis`

  return {
    partnerId,
    target,
    files: [
      {
        name: `${baseName}.maple`,
        kind: 'maple',
        mimeType: 'text/x-maple',
        contents: input.maple,
      },
      {
        name: `${baseName}.nwk`,
        kind: 'newick',
        mimeType: 'text/plain',
        contents: input.newick,
      },
    ],
    metadata: {
      datasetName,
      sourceApp: 'Syrup',
    },
    launch: {
      datasetName,
      defaultView: 'Phylogenetic Tree',
    },
  }
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open the MicrobeTrace export database.'))
  })
}

async function storeRecord(record: HandoffRecord) {
  const database = await openDatabase()

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const cursorRequest = store.openCursor()

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) {
        store.put(record)
        return
      }
      if (!cursor.value || Number(cursor.value.expiresAt) <= Date.now()) cursor.delete()
      cursor.continue()
    }
    transaction.oncomplete = () => {
      database.close()
      resolve()
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error('Unable to stage the MicrobeTrace export.'))
    }
    transaction.onabort = transaction.onerror
  })
}

export function readHandoffId(hash: string): string {
  const id = new URLSearchParams(hash.replace(/^#/, '')).get('handoff') ?? ''
  return /^[a-z0-9-]{16,128}$/i.test(id) ? id : ''
}

export async function readMicrobeTraceHandoff(id: string): Promise<MicrobeTraceOptions> {
  const database = await openDatabase()
  const record = await new Promise<HandoffRecord | undefined>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(id)
    request.onsuccess = () => resolve(request.result as HandoffRecord | undefined)
    request.onerror = () => reject(request.error ?? new Error('Unable to read the staged analysis.'))
    transaction.oncomplete = () => database.close()
  })

  const { partnerId, target } = getMicrobeTraceConfig()
  if (!record || record.id !== id || record.version !== 1 || !Array.isArray(record.options?.files)) {
    throw new Error('The staged analysis is missing or malformed.')
  }
  if (!Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now()) {
    throw new Error('The staged analysis has expired. Return to Syrup and try again.')
  }
  if (record.options.partnerId !== partnerId || record.options.target !== target) {
    throw new Error('The staged analysis does not match this Syrup environment.')
  }

  return record.options
}

export function loadMicrobeTraceSdk(target: string): Promise<MicrobeTraceEmbedApi> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = new URL('assets/embed/microbetrace-embed.js', target).toString()
    script.onload = () => {
      const api = window.MicrobeTraceEmbed
      if (api) resolve(api)
      else reject(new Error('The MicrobeTrace SDK loaded without its browser API.'))
    }
    script.onerror = () => reject(new Error('Could not load the MicrobeTrace SDK.'))
    document.head.appendChild(script)
  })
}

export async function openMicrobeTraceHandoff(options: MicrobeTraceOptions) {
  const api = window.MicrobeTraceEmbed
  if (!api) throw new Error('The MicrobeTrace SDK is not available on this page.')
  return api.open(options)
}

export async function deleteMicrobeTraceHandoff(id: string): Promise<void> {
  const database = await openDatabase()

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(id)
    transaction.oncomplete = () => {
      database.close()
      resolve()
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error('Unable to clear the staged analysis.'))
    }
  })
}

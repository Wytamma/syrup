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

type MicrobeTraceOptions = {
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

  const bridgeUrl = new URL('microbetrace-export.html', document.baseURI)
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

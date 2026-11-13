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

type MicrobeTraceEmbedApi = {
  open(options: MicrobeTraceOptions): Promise<unknown>
}

declare global {
  interface Window {
    MicrobeTraceEmbed?: MicrobeTraceEmbedApi
  }
}

export type MicrobeTraceExport = {
  /** Saved tree name, already free of its file extension. */
  name: string
  maple: string
  newick: string
}

const SDK_PATH = 'assets/embed/microbetrace-embed.js'

let sdkPromise: Promise<MicrobeTraceEmbedApi> | null = null

export function getMicrobeTraceConfig(
  location: Pick<Location, 'hostname'> = window.location,
) {
  const isLocal =
    location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  return isLocal
    ? { partnerId: 'local-dev', target: 'http://localhost:4200/' }
    : { partnerId: 'syrup', target: 'https://microbetrace.cdc.gov/MicrobeTrace/' }
}

export function buildMicrobeTraceOptions(
  input: MicrobeTraceExport,
): MicrobeTraceOptions {
  const { partnerId, target } = getMicrobeTraceConfig()
  // Saved tree names are already extension-free (".429" must not be stripped).
  const baseName = input.name || 'syrup-analysis'
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

export function loadMicrobeTraceSdk(
  target: string,
): Promise<MicrobeTraceEmbedApi> {
  const cached = sdkPromise
  if (cached) return cached

  const pending = new Promise<MicrobeTraceEmbedApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = new URL(SDK_PATH, target).toString()
    script.onload = () => {
      const api = window.MicrobeTraceEmbed
      if (api) resolve(api)
      else reject(new Error('The MicrobeTrace SDK loaded without its browser API.'))
    }
    script.onerror = () => reject(new Error('Could not load the MicrobeTrace SDK.'))
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    sdkPromise = null
    throw error
  })

  sdkPromise = pending
  return pending
}

/** Hands one saved tree to MicrobeTrace through its partner embed SDK. */
export async function sendToMicrobeTrace(input: MicrobeTraceExport) {
  const options = buildMicrobeTraceOptions(input)
  const api = window.MicrobeTraceEmbed ?? (await loadMicrobeTraceSdk(options.target))
  await api.open(options)
}

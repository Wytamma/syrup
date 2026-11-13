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

type MicrobeTraceEnvironment = {
  VITE_MICROBETRACE_TARGET?: string
}

const SDK_PATH = 'assets/embed/microbetrace-embed.js'
const LOCAL_TARGET = 'http://localhost:4200/'
const DEVELOPMENT_TARGET = 'https://cdcgov.github.io/MicrobeTrace/'
const PRODUCTION_TARGET = 'https://microbetrace.cdc.gov/MicrobeTrace/'
const DEPLOYED_TARGETS = new Set([DEVELOPMENT_TARGET, PRODUCTION_TARGET])

let sdkPromise: Promise<MicrobeTraceEmbedApi> | null = null

export function getMicrobeTraceConfig(
  location: Pick<Location, 'hostname'> = window.location,
  environment: MicrobeTraceEnvironment = import.meta.env ?? {},
) {
  const isLocal =
    location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  const configuredTarget = environment.VITE_MICROBETRACE_TARGET?.trim()
  const target = normalizeTarget(configuredTarget || (isLocal ? LOCAL_TARGET : DEVELOPMENT_TARGET))
  const approvedTargets = isLocal
    ? new Set([LOCAL_TARGET, ...DEPLOYED_TARGETS])
    : DEPLOYED_TARGETS

  if (!approvedTargets.has(target)) {
    throw new Error('VITE_MICROBETRACE_TARGET must use an approved MicrobeTrace deployment URL.')
  }

  return {
    partnerId: isLocal ? 'local-dev' : 'syrup',
    target,
  }
}

function normalizeTarget(value: string) {
  const target = new URL(value)
  if (target.username || target.password) {
    throw new Error('VITE_MICROBETRACE_TARGET may not contain credentials.')
  }
  target.search = ''
  target.hash = ''
  if (!target.pathname.endsWith('/')) target.pathname += '/'
  return target.toString()
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

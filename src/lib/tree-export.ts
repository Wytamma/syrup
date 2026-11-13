import type { StoredTree } from './tree-store'

export const CLOCKOR2_URL: string = import.meta.env?.VITE_CLOCKOR2_URL ?? 'https://clockor2.github.io/'

export const TRAKKA_URL: string = import.meta.env?.VITE_TRAKKA_URL ?? 'https://scout.trakka.org/'

export function treeBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || 'cmaple-tree'
}

export function treeDownloadName(sourceFileName: string, hasNexus: boolean): string {
  const baseName = treeBaseName(sourceFileName)
  return hasNexus ? `${baseName}.mat.nex` : `${baseName}.nwk`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export function formatTreeMeta(tree: StoredTree): string {
  return `${formatBytes(tree.sizeBytes)} · ${tree.sampleCount} tips · lnL ${Math.round(tree.logLikelihood)} · ${new Date(tree.savedAt).toLocaleString()}`
}

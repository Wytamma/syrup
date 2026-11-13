import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatBytes, formatTreeMeta, treeBaseName, treeDownloadName } from './tree-export.ts'
import type { StoredTree } from './tree-store.ts'

test('treeBaseName strips the last extension and falls back to a default', () => {
  assert.equal(treeBaseName('B.1.429.maple'), 'B.1.429')
  assert.equal(treeBaseName(''), 'cmaple-tree')
})

test('treeDownloadName picks the nexus extension when nexus is available', () => {
  assert.equal(treeDownloadName('B.1.429.maple', false), 'B.1.429.nwk')
  assert.equal(treeDownloadName('B.1.429.maple', true), 'B.1.429.mat.nex')
})

test('formatBytes scales from bytes to mebibytes', () => {
  assert.equal(formatBytes(123), '123 B')
  assert.equal(formatBytes(1536), '1.5 KiB')
  assert.equal(formatBytes(2 * 1024 * 1024), '2.0 MiB')
})

test('formatTreeMeta reports size, tips and log likelihood', () => {
  const record: StoredTree = {
    id: 'seed',
    savedAt: Date.now(),
    name: 'seed',
    sourceFileName: 'seed.nwk',
    newick: '((a:1,b:1):1,c:2);',
    nexus: '',
    maple: '',
    logLikelihood: -12.6,
    sampleCount: 3,
    sequenceLength: 3,
    sequenceType: 'dna',
    sizeBytes: 18,
  }

  const meta = formatTreeMeta(record)
  assert.match(meta, /18 B/)
  assert.match(meta, /3 tips/)
  assert.match(meta, /lnL -13/)
})

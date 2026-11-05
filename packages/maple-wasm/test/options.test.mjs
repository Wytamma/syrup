import assert from 'node:assert/strict'
import test from 'node:test'
import { MapleError } from '../dist/errors.js'
import {
  branchSupportMethodId,
  formatId,
  substitutionModelId,
  treeSearchTypeId,
} from '../dist/ids.js'
import {
  DEFAULT_MAX_DIVERGENCE_PERCENT,
  resolveInferenceOptions,
  resolveWarningSummaryOptions,
  sanitizeConstantSites,
} from '../dist/options.js'

test('sanitizes constant site counts', () => {
  assert.deepEqual(sanitizeConstantSites({ a: 1.9, c: -2, g: Number.NaN, t: 4 }), {
    a: 1,
    c: 0,
    g: 0,
    t: 4,
  })
  assert.deepEqual(sanitizeConstantSites(undefined), { a: 0, c: 0, g: 0, t: 0 })
})

test('resolves inference defaults', () => {
  const resolved = resolveInferenceOptions()
  assert.equal(resolved.substitutionModel, 'GTR')
  assert.equal(resolved.branchSupportMethod, 'sprta')
  assert.equal(resolved.branchSupportReplicates, 1000)
  assert.equal(resolved.branchSupportEpsilon, 0.1)
  assert.equal(resolved.maxDivergencePercent, DEFAULT_MAX_DIVERGENCE_PERCENT)
  assert.equal(resolved.treeSearchType, 'normal')
  assert.equal(resolved.filterDivergentSamples, false)
  assert.ok(resolved.numThreads >= 1)
})

test('resolves inference overrides and clamps invalid numbers', () => {
  const resolved = resolveInferenceOptions({
    numThreads: 0,
    substitutionModel: 'LG',
    branchSupportMethod: 'none',
    branchSupportReplicates: -5,
    branchSupportEpsilon: Number.NaN,
    maxDivergencePercent: -1,
    constantSites: { a: 2, c: 0, g: 0, t: 0 },
    startingTree: '(a,b);',
    treeSearchType: 'fast',
  })
  assert.ok(resolved.numThreads >= 1)
  assert.equal(resolved.substitutionModel, 'LG')
  assert.equal(resolved.branchSupportMethod, 'none')
  assert.equal(resolved.branchSupportReplicates, 1000)
  assert.equal(resolved.branchSupportEpsilon, 0.1)
  assert.equal(resolved.maxDivergencePercent, DEFAULT_MAX_DIVERGENCE_PERCENT)
  assert.deepEqual(resolved.constantSites, { a: 2, c: 0, g: 0, t: 0 })
  assert.equal(resolved.startingTree, '(a,b);')
  assert.equal(resolved.treeSearchType, 'fast')
})

test('resolves warning summary options', () => {
  assert.deepEqual(resolveWarningSummaryOptions(), {
    filterDivergentSamples: false,
    maxDivergencePercent: DEFAULT_MAX_DIVERGENCE_PERCENT,
    constantSites: { a: 0, c: 0, g: 0, t: 0 },
  })
  assert.equal(
    resolveWarningSummaryOptions({ filterDivergentSamples: true, maxDivergencePercent: 2 }).filterDivergentSamples,
    true,
  )
})

test('maps option names to the native ABI ids', () => {
  assert.equal(formatId('auto'), 0)
  assert.equal(formatId('fasta'), 1)
  assert.equal(formatId('phylip'), 2)
  assert.equal(formatId('maple'), 3)
  assert.equal(branchSupportMethodId('none'), 0)
  assert.equal(branchSupportMethodId('sh-alrt'), 2)
  assert.equal(substitutionModelId('GTR'), 0)
  assert.equal(substitutionModelId('NQ.YEAST'), 38)
  assert.equal(treeSearchTypeId('exhaustive'), 2)
  assert.throws(() => formatId('nonsense'), MapleError)
})

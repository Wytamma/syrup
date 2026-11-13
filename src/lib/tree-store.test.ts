import assert from 'node:assert/strict'
import { test } from 'node:test'
import { treeStorageBytes } from './tree-store.ts'

test('treeStorageBytes counts Newick, NEXUS and MAPLE together', () => {
  const newick = '((a:1,b:1):1,c:2);'
  const nexus = '#NEXUS\nBEGIN TREES; END;'
  const maple = '3 3\nA 1 2 3\n'

  const expected =
    Buffer.byteLength(newick, 'utf8') + Buffer.byteLength(nexus, 'utf8') + Buffer.byteLength(maple, 'utf8')

  assert.equal(treeStorageBytes({ newick, nexus, maple }), expected)
  assert.ok(treeStorageBytes({ newick, nexus, maple }) > Buffer.byteLength(newick) * 2)
})

test('treeStorageBytes tolerates missing exports and multibyte text', () => {
  assert.equal(treeStorageBytes({ newick: 'é', nexus: '', maple: '' }), 2)
  assert.equal(treeStorageBytes({ newick: 'é', nexus: '', maple: '' }), Buffer.byteLength('é', 'utf8'))
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCmapleAnnotations, parseCmapleNewick, parseNewick } from './newick.ts'

test('parses annotations on terminal and internal branches', () => {
  const tree = parseNewick(
    "('sample A':0[&mutationsInf={A12G:0.9}],B:1e-3)[&mutationsInf={C34T:0.8,G56A:0.7}]:2;",
    parseCmapleAnnotations,
  )

  assert.equal(tree.branch_length, 2)
  assert.deepEqual(tree.annotations?.mutationsInf, ['C34T', 'G56A'])
  assert.equal(tree.children?.[0].name, "'sample A'")
  assert.equal(tree.children?.[0].branch_length, 0)
  assert.deepEqual(tree.children?.[0].annotations?.mutationsInf, ['A12G'])
  assert.equal(tree.children?.[1].branch_length, 0.001)
})

test('preserves comments and parses support annotations', () => {
  const tree = parseNewick('A:0[&sprta=0.52364];', parseCmapleAnnotations)
  assert.equal(tree.comment, '&sprta=0.52364')
  assert.deepEqual(tree.annotations, { sprta: 0.52364 })
})

test('parses support annotations and ignores support copied from an input tree', () => {
  const tree = parseCmapleNewick(
    '(A:1,B:1)in12:1[&sprta=0.95,sh_alrt=87.4,input_sprta=0.2];',
  )

  assert.equal(tree.name, undefined)
  assert.equal(tree.comment, '&sprta=0.95,sh_alrt=87.4,input_sprta=0.2')
  assert.equal(tree.annotations?.sprta, 0.95)
  assert.equal(tree.annotations?.sh_alrt, 87.4)

  const inputOnly = parseCmapleNewick('(A:1,B:1)in2:1[&input_sprta=0.2];')
  assert.equal(inputOnly.annotations, undefined)
})

test('preserves user internal names while removing CMAPLE generated names', () => {
  const tree = parseCmapleNewick('((A:1,B:1)in2:1,(C:1,D:1)clade:1)in1:0;')
  assert.equal(tree.name, undefined)
  assert.equal(tree.children?.[0].name, undefined)
  assert.equal(tree.children?.[1].name, 'clade')
})

test('removes mutations copied to zero-length terminal leaves by CMAPLE NEXUS export', () => {
  const tree = parseCmapleNewick(
    '((A:0[&mutationsInf={G4207T:1}],B:0[&mutationsInf={G4207T:1}])in2:0[&mutationsInf={G4207T:1}],C:0[&mutationsInf={C635T:1}])in1:1[&mutationsInf={G4207T:1}];',
  )

  assert.equal(tree.annotations?.mutationsInf?.[0], 'G4207T')
  assert.equal(tree.children?.[0].annotations?.mutationsInf?.[0], 'G4207T')
  assert.equal(tree.children?.[0].children?.[0].annotations, undefined)
  assert.equal(tree.children?.[0].children?.[1].annotations, undefined)
  assert.deepEqual(tree.children?.[1].annotations?.mutationsInf, ['C635T'])
})

test('removes copied mutations through zero-length binary less-info ladders', () => {
  const tree = parseCmapleNewick(
    '((A:0[&mutationsInf={T23155C:1}],B:0[&mutationsInf={T23155C:1}])0:0,C:0[&mutationsInf={T23155C:1}])SRR1764070_MinorSeqsClade:1[&mutationsInf={T23155C:1}];',
  )

  assert.equal(tree.annotations?.mutationsInf?.[0], 'T23155C')
  assert.equal(tree.children?.[0].annotations, undefined)
  assert.equal(tree.children?.[0].children?.[0].annotations, undefined)
  assert.equal(tree.children?.[0].children?.[1].annotations, undefined)
  assert.equal(tree.children?.[1].annotations, undefined)
})

test('preserves support on zero-length terminal leaves when removing copied mutations', () => {
  const tree = parseCmapleNewick(
    '(A:0[&sprta=0.999,mutationsInf={G4207T:1}])in1:1[&mutationsInf={G4207T:1}];',
  )

  assert.deepEqual(tree.children?.[0].annotations, { sprta: 0.999 })
})

test('uses the default and custom annotation parsers', () => {
  assert.equal(parseNewick('A:1[first];').comment, 'first')

  const tree = parseNewick('A:1[first][second];', (annotation) => ({ [annotation]: true }))
  assert.equal(tree.first, true)
  assert.equal(tree.second, true)
})

test('rejects malformed Newick input', () => {
  assert.throws(() => parseNewick('(A:1,B:2;'), /Unclosed parenthesis/)
  assert.throws(() => parseNewick('A:not-a-number;'), /Invalid branch length/)
  assert.throws(() => parseNewick('A:;'), /Expected a branch length/)
  assert.throws(() => parseNewick('A:1[comment;'), /Unclosed Newick comment/)
  assert.throws(() => parseNewick(',A:1;'), /Unexpected comma/)
})

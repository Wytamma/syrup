import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getAnnotationSupportNodes,
  getAnnotationSupportPosition,
  getAnnotationSupportText,
  getMutationBranchNodes,
  getMutationBranchPosition,
  getMutationBranchText,
  type MutationBranchNode,
} from './mutation-branch-label-data.ts'

test('selects annotated internal and terminal branches but not the root or hidden nodes', () => {
  const root: MutationBranchNode = { x: 0, y: 1, preIndex: 0, totalNodes: 4 }
  const internal: MutationBranchNode = {
    x: 2,
    y: 1,
    parent: root,
    annotations: { mutationsInf: ['A12G'] },
  }
  const terminal: MutationBranchNode = {
    x: 4,
    y: 0,
    parent: internal,
    annotations: { mutationsInf: ['C34T', 'G56A'] },
  }
  const hidden: MutationBranchNode = {
    x: 4,
    y: 2,
    parent: internal,
    isHidden: true,
    annotations: { mutationsInf: ['T78C'] },
  }
  root.annotations = { mutationsInf: ['root mutation'] }

  assert.deepEqual(getMutationBranchNodes({ root, preorderTraversal: [root, internal, terminal, hidden] }), [
    internal,
    terminal,
  ])
  assert.equal(getMutationBranchText(terminal), 'C34T | G56A')
})

test('positions a label at the midpoint of its incoming rectangular branch', () => {
  const parent: MutationBranchNode = { x: 2, y: 3 }
  const node: MutationBranchNode = { x: 6, y: 5, parent }
  assert.deepEqual(getMutationBranchPosition(node), [4, 5])

  const zeroLengthNode: MutationBranchNode = { x: 2, y: 7, parent }
  assert.deepEqual(getMutationBranchPosition(zeroLengthNode), [2, 7])
})

test('selects annotation support for unnamed visible internal nodes with SPRTA precedence', () => {
  const root: MutationBranchNode = { x: 0, y: 1, preIndex: 0, totalNodes: 4 }
  const sprta: MutationBranchNode = {
    x: 2,
    y: 1,
    parent: root,
    annotations: { sprta: 0.95, sh_alrt: 87.4 },
  }
  const shAlrt: MutationBranchNode = {
    x: 3,
    y: 2,
    parent: root,
    annotations: { sh_alrt: 91.2 },
  }
  const named: MutationBranchNode = {
    x: 4,
    y: 3,
    parent: root,
    name: 'clade',
    annotations: { sprta: 0.5 },
  }

  assert.deepEqual(getAnnotationSupportNodes({ root, preorderTraversal: [root, sprta, shAlrt, named] }), [
    sprta,
    shAlrt,
  ])
  assert.equal(getAnnotationSupportText(sprta), '0.95')
  assert.equal(getAnnotationSupportText(shAlrt), '91.2')
  assert.deepEqual(getAnnotationSupportPosition(sprta), [2, 1])
})

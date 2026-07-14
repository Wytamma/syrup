export type MutationBranchNode = {
  x: number
  y: number
  parent?: MutationBranchNode
  preIndex?: number
  totalNodes?: number
  isHidden?: boolean
  isLeaf?: boolean
  name?: string
  annotations?: {
    mutationsInf?: string[]
    sprta?: number
    sh_alrt?: number
  }
}

export type MutationBranchGraph = {
  root: MutationBranchNode
  preorderTraversal: MutationBranchNode[]
}

export function getMutationBranchNodes(graph: MutationBranchGraph) {
  const start = (graph.root.preIndex ?? 0) + 1
  const end = start + Math.max(0, (graph.root.totalNodes ?? graph.preorderTraversal.length) - 1)

  return graph.preorderTraversal
    .slice(start, end)
    .filter((node) => !node.isHidden && (node.annotations?.mutationsInf?.length ?? 0) > 0)
}

export function getMutationBranchPosition(node: MutationBranchNode): [number, number] {
  if (!node.parent) return [node.x, node.y]
  return [(node.x + node.parent.x) / 2, node.y]
}

export function getMutationBranchText(node: MutationBranchNode) {
  return node.annotations?.mutationsInf?.join(' | ') ?? ''
}

export function getAnnotationSupportNodes(graph: MutationBranchGraph) {
  const start = graph.root.preIndex ?? 0
  const end = start + (graph.root.totalNodes ?? graph.preorderTraversal.length)

  return graph.preorderTraversal.slice(start, end).filter((node) => {
    const support = node.annotations?.sprta ?? node.annotations?.sh_alrt
    return !node.isLeaf && !node.isHidden && !node.name && support !== undefined
  })
}

export function getAnnotationSupportPosition(node: MutationBranchNode): [number, number] {
  return [node.x, node.y]
}

export function getAnnotationSupportText(node: MutationBranchNode) {
  return (node.annotations?.sprta ?? node.annotations?.sh_alrt)?.toString() ?? ''
}

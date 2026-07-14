export type NewickNode = {
  name?: string
  branch_length?: number
  children?: NewickNode[]
  comment?: unknown
  annotations?: {
    mutationsInf?: string[]
    sprta?: number
    sh_alrt?: number
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type ParseNewickAnnotations = (annotation: string) => unknown

type NewickToken =
  | { type: 'comment'; value: string }
  | { type: 'delimiter'; value: '(' | ')' | ',' | ':' | ';' }
  | { type: 'value'; value: string }

const delimiters = new Set(['(', ')', ',', ':', ';'])

function tokenizeNewick(input: string): NewickToken[] {
  const tokens: NewickToken[] = []
  let index = 0

  while (index < input.length) {
    if (/\s/.test(input[index])) {
      index += 1
      continue
    }

    const character = input[index]
    if (delimiters.has(character)) {
      tokens.push({ type: 'delimiter', value: character as '(' | ')' | ',' | ':' | ';' })
      index += 1
      continue
    }

    if (character === '[') {
      const start = ++index
      let depth = 1
      let quote = ''

      while (index < input.length && depth > 0) {
        const current = input[index]
        if (quote) {
          if (current === quote) quote = ''
        } else if (current === "'" || current === '"') {
          quote = current
        } else if (current === '[') {
          depth += 1
        } else if (current === ']') {
          depth -= 1
        }
        index += 1
      }

      if (depth !== 0) throw new SyntaxError('Unclosed Newick comment.')
      tokens.push({ type: 'comment', value: input.slice(start, index - 1) })
      continue
    }

    const start = index
    let quote = ''
    while (index < input.length) {
      const current = input[index]
      if (quote) {
        if (current === quote) {
          if (input[index + 1] === quote) {
            index += 2
            continue
          }
          quote = ''
        }
        index += 1
        continue
      }
      if (current === "'" || current === '"') {
        quote = current
        index += 1
        continue
      }
      if (delimiters.has(current) || current === '[') break
      index += 1
    }

    if (quote) throw new SyntaxError('Unclosed quoted Newick value.')
    const value = input.slice(start, index).trim()
    if (value) tokens.push({ type: 'value', value })
  }

  return tokens
}

function defaultParseNewickAnnotations(annotation: string) {
  return { comment: annotation }
}

function addAnnotationToNode(node: NewickNode, parsedAnnotation: unknown) {
  if (parsedAnnotation !== null && typeof parsedAnnotation === 'object' && !Array.isArray(parsedAnnotation)) {
    Object.assign(node, parsedAnnotation)
    return
  }

  node.comment = parsedAnnotation
}

export function parseNewick(input: string, parseNewickAnnotations: ParseNewickAnnotations = defaultParseNewickAnnotations) {
  if (typeof input !== 'string') throw new TypeError('Newick input must be a string.')
  if (typeof parseNewickAnnotations !== 'function') {
    throw new TypeError('parseNewickAnnotations must be a function.')
  }

  const ancestors: NewickNode[] = []
  let tree: NewickNode = {}
  const tokens = tokenizeNewick(input)
  let expectingBranchLength = false
  let canAcceptName = true

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]

    if (token.type === 'comment') {
      addAnnotationToNode(tree, parseNewickAnnotations(token.value))
      continue
    }

    if (token.type === 'delimiter') {
      switch (token.value) {
        case '(': {
          const subtree: NewickNode = {}
          tree.children = [subtree]
          ancestors.push(tree)
          tree = subtree
          canAcceptName = true
          expectingBranchLength = false
          break
        }
        case ',': {
          if (ancestors.length === 0) throw new SyntaxError(`Unexpected comma at token ${index}.`)
          const sibling: NewickNode = {}
          ancestors[ancestors.length - 1].children?.push(sibling)
          tree = sibling
          canAcceptName = true
          expectingBranchLength = false
          break
        }
        case ')':
          if (ancestors.length === 0) throw new SyntaxError(`Unexpected closing parenthesis at token ${index}.`)
          tree = ancestors.pop() as NewickNode
          canAcceptName = true
          expectingBranchLength = false
          break
        case ':':
          if (expectingBranchLength) throw new SyntaxError(`Unexpected colon at token ${index}.`)
          expectingBranchLength = true
          canAcceptName = false
          break
        case ';':
          if (expectingBranchLength) throw new SyntaxError('Expected a branch length after colon.')
          expectingBranchLength = false
          canAcceptName = false
          break
      }
      continue
    }

    if (expectingBranchLength) {
      const branchLength = Number(token.value)
      if (!Number.isFinite(branchLength)) throw new SyntaxError(`Invalid branch length "${token.value}".`)
      tree.branch_length = branchLength
      expectingBranchLength = false
      canAcceptName = false
    } else if (canAcceptName) {
      tree.name = token.value
      canAcceptName = false
    } else {
      throw new SyntaxError(`Unexpected value "${token.value}" at token ${index}.`)
    }
  }

  if (expectingBranchLength) throw new SyntaxError('Expected a branch length after colon.')
  if (ancestors.length !== 0) throw new SyntaxError('Unclosed parenthesis in Newick input.')
  return tree
}

export function parseCmapleAnnotations(annotation: string) {
  const annotations: NonNullable<NewickNode['annotations']> = {}
  const mutationsMatch = annotation.match(/mutationsInf\s*=\s*\{([^}]*)\}/)
  const sprtaMatch = annotation.match(/(?:^|[&,])\s*sprta\s*=\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/i)
  const shAlrtMatch = annotation.match(/(?:^|[&,])\s*sh_alrt\s*=\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/i)

  if (mutationsMatch) {
    annotations.mutationsInf = mutationsMatch[1]
      .split(',')
      .map((entry) => entry.split(':', 1)[0].trim())
      .filter(Boolean)
  }
  if (sprtaMatch) annotations.sprta = Number(sprtaMatch[1])
  if (shAlrtMatch) annotations.sh_alrt = Number(shAlrtMatch[1])

  if (Object.keys(annotations).length === 0) return { comment: annotation }

  return {
    comment: annotation,
    annotations,
  }
}

export function isGeneratedInternalName(name: string) {
  return /^in\d+$/.test(name) || name.endsWith('_MinorSeqsClade')
}

export function removeGeneratedInternalNames(node: NewickNode) {
  if (node.children && typeof node.name === 'string' && isGeneratedInternalName(node.name)) {
    delete node.name
  }
  node.children?.forEach(removeGeneratedInternalNames)
  return node
}

export function parseCmapleNewick(input: string) {
  return removeGeneratedInternalNames(parseNewick(input, parseCmapleAnnotations))
}

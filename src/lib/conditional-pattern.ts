import { compileMetadataCondition } from './metadata-condition'
import { validateMetadataModifiers } from './metadata-modifiers'
import { scanMetadataTokens, scanPatternExpressions } from './metadata-pattern'
import { resolveFileToken, validateTokenFormat } from './metadata-values'
import type { FileEntry } from './rename'

type Predicate = (file: FileEntry, index: number) => boolean
type Node = string | { branches: Array<{ matches?: Predicate; nodes: Node[] }> }

export interface CompiledConditionalPattern {
  /** Select branches; ordinary metadata and captures are expanded afterward. */
  render: (file: FileEntry, index: number) => string
}

/** Validate every branch once, without requiring any file metadata. */
export function compileConditionalPattern(pattern: string): CompiledConditionalPattern {
  const root: Node[] = []
  const stack: Array<{ node: Exclude<Node, string>; parent: Node[]; hasElse: boolean }> = []
  let current = root
  let cursor = 0
  const directives = scanPatternExpressions(pattern, true).filter(token => token.kind === 'condition')
  const appendText = (end: number) => {
    const fragment = pattern.slice(cursor, end)
    // Validate fragments independently so branch joins cannot create unchecked tokens.
    for (const token of scanMetadataTokens(fragment, true)) {
      if (token.error) throw new Error(token.error)
      // A standalone opening brace can be literal text, as in existing patterns.
      if (!token.key) {
        if (directives.length) throw new Error('Keep each metadata expression within one conditional branch.')
        continue
      }
      if (!token.complete) throw new Error('Close the metadata expression with }.')
      validateTokenFormat(token.key, token.format)
      validateMetadataModifiers(token.modifiers)
    }
    current.push(fragment)
  }
  for (const token of directives) {
    if (!token.complete) throw new Error(`Close the {${token.directive}} directive with } and close any quoted value.`)
    appendText(token.start)
    cursor = token.end
    const { directive, query } = token
    let matches: Predicate | undefined
    if (directive === 'if' || directive === 'elseif') {
      if (!query.trim()) throw new Error(`Add a metadata condition after ${directive}, for example orientation:landscape.`)
      const compiled = compileMetadataCondition(query, resolveFileToken)
      if (compiled.error) throw new Error(`Invalid ${directive} condition: ${compiled.error.message}`)
      matches = compiled.matches
    } else if (query.trim()) throw new Error(`The {${directive}} directive does not accept a condition.`)

    if (directive === 'if') {
      if (stack.length >= 16) throw new Error('Use at most 16 nested conditional blocks.')
      const node: Exclude<Node, string> = { branches: [{ matches, nodes: [] }] }
      current.push(node)
      stack.push({ node, parent: current, hasElse: false })
      current = node.branches[0].nodes
      continue
    }
    const block = stack.at(-1)
    if (!block) throw new Error(`{${directive}} needs an opening {if condition}.`)
    if (directive === 'end') {
      stack.pop()
      current = block.parent
    } else {
      if (block.hasElse) throw new Error(`{${directive}} cannot follow {else} in the same conditional block.`)
      block.hasElse = directive === 'else'
      const branch = { matches, nodes: [] as Node[] }
      block.node.branches.push(branch)
      current = branch.nodes
    }
  }
  if (stack.length) throw new Error('Close each {if condition} block with {end}.')
  appendText(pattern.length)

  const render = (nodes: Node[], file: FileEntry, index: number): string => nodes.map(node => {
    if (typeof node === 'string') return node
    const branch = node.branches.find(candidate => !candidate.matches || candidate.matches(file, index))
    return branch ? render(branch.nodes, file, index) : ''
  }).join('')
  return { render: (file, index) => render(root, file, index) }
}

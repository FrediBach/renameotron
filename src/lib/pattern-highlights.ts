import { metadataHighlight, type CaptureGroup, type HighlightSpan } from './highlight-types'

function decodedGroupName(name: string): string {
  return name.replace(/\\u(?:\{([\da-fA-F]+)\}|([\da-fA-F]{4}))/g, (original, braced: string | undefined, fixed: string | undefined) => {
    const codePoint = Number.parseInt(braced ?? fixed!, 16)
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : original
  })
}

/** A tolerant lexer: unfinished patterns still get useful syntax highlighting. */
export function tokenizeRegex(pattern: string): { spans: HighlightSpan[]; groups: CaptureGroup[] } {
  const spans: HighlightSpan[] = []
  const groups: CaptureGroup[] = []
  const stack: Array<CaptureGroup | undefined> = []
  const references: Array<{ span: HighlightSpan; reference: string }> = []
  const add = (start: number, end: number, kind: HighlightSpan['kind'], label: string, group?: number) => {
    const span: HighlightSpan = { start, end, kind, label, ...(group === undefined ? {} : { group }) }
    spans.push(span)
    return span
  }

  for (let cursor = 0; cursor < pattern.length;) {
    const start = cursor
    const character = pattern[cursor]
    if (character === '\\') {
      const escape = pattern.slice(cursor).match(/^\\(?:[pP]\{[^}]*\}?|u\{[\da-fA-F]*\}?|u[\da-fA-F]{4}|x[\da-fA-F]{2}|c[A-Za-z]|k<[^>]*>?|[1-9]\d*|[\s\S])/)?.[0] ?? '\\'
      cursor += escape.length
      const span = add(start, cursor, 'escape', 'Escape or character class')
      if (/^\\[1-9]\d*$/.test(escape)) references.push({ span, reference: escape.slice(1) })
      else if (/^\\k<.+>$/.test(escape)) references.push({ span, reference: decodedGroupName(escape.slice(3, -1)) })
    } else if (character === '[') {
      cursor++
      while (cursor < pattern.length) {
        if (pattern[cursor] === '\\') cursor = Math.min(cursor + 2, pattern.length)
        else if (pattern[cursor++] === ']') break
      }
      add(start, cursor, 'escape', 'Character class')
    } else if (character === '(') {
      const named = pattern.slice(cursor).match(/^\(\?<([^=!][^>]*)>/)
      let group: CaptureGroup | undefined
      if (named || pattern[cursor + 1] !== '?') {
        group = { index: groups.length + 1, ...(named ? { name: decodedGroupName(named[1]) } : {}) }
        groups.push(group)
      }
      const noncapturing = pattern.slice(cursor).match(/^\(\?(?:[=!]|<[=!]|:|[ims]*-?[ims]+:)/)?.[0]
      cursor += named?.[0].length ?? noncapturing?.length ?? 1
      stack.push(group)
      add(start, cursor, group ? 'group' : 'syntax', group ? captureLabel(group) : 'Non-capturing group or assertion', group?.index)
    } else if (character === ')') {
      const group = stack.pop()
      cursor++
      add(start, cursor, group ? 'group' : 'syntax', group ? captureLabel(group) : 'End of group or assertion', group?.index)
    } else if (character === '{' && /^\{\d+(?:,\d*)?\}/.test(pattern.slice(cursor))) {
      const quantifier = pattern.slice(cursor).match(/^\{\d+(?:,\d*)?\}\??/)![0]
      cursor += quantifier.length
      add(start, cursor, 'syntax', 'Quantifier')
    } else if ('*+?'.includes(character)) {
      cursor += pattern[cursor + 1] === '?' ? 2 : 1
      add(start, cursor, 'syntax', 'Quantifier')
    } else if ('^$|.'.includes(character)) {
      cursor++
      add(start, cursor, 'syntax', character === '|' ? 'Alternation' : character === '.' ? 'Any character' : 'Anchor')
    } else cursor++
  }

  for (const { span, reference } of references) {
    const group = /^\d+$/.test(reference)
      ? groups.find(group => group.index === Number(reference))
      : groups.find(group => group.name === reference)
    if (group) { span.kind = 'group'; span.group = group.index; span.label = `Backreference to ${captureLabel(group).toLowerCase()}` }
  }
  return { spans, groups }
}

export function captureLabel(group: CaptureGroup): string {
  return `Capture group ${group.index}${group.name ? ` (${group.name})` : ''}`
}

/** Follow JavaScript's two-digit capture fallback ($12 can mean $1 + literal 2). */
export function tokenizeReplacement(replacement: string, groups: CaptureGroup[]): HighlightSpan[] {
  const spans: HighlightSpan[] = []
  const tokens = /\$\$|\$[&`']|\$\d{1,2}|\$<[^>]*>|\{[^{}]*\}?/g
  for (const match of replacement.matchAll(tokens)) {
    const token = match[0]
    const start = match.index
    if (token.startsWith('{')) {
      const key = token.match(/^\{([a-zA-Z][\w-]*)/)?.[1]
      spans.push({ start, end: start + token.length, ...(key ? metadataHighlight(key) : { kind: 'metadata' as const }), label: `Metadata: ${token.replace(/[{}]/g, '')}` })
      continue
    }
    if (token === '$&') {
      spans.push({ start, end: start + 2, kind: 'match', label: 'Full match' })
      continue
    }
    if (token === '$$' || token === "$`" || token === "$'") {
      spans.push({ start, end: start + 2, kind: 'escape', label: token === '$$' ? 'Literal dollar sign' : token === "$`" ? 'Text before the match' : 'Text after the match' })
      continue
    }
    let group: CaptureGroup | undefined
    let length = token.length
    // Unlike regex group declarations, replacement names are literal strings.
    if (token.startsWith('$<')) group = groups.find(group => group.name === token.slice(2, -1))
    else {
      group = groups.find(group => group.index === Number(token.slice(1)))
      if (!group && token.length === 3) {
        group = groups.find(group => group.index === Number(token[1]))
        length = 2
      }
    }
    if (group) spans.push({ start, end: start + length, kind: 'group', group: group.index, label: captureLabel(group) })
  }
  return spans
}

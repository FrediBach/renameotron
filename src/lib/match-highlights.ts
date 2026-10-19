import type { HighlightSpan } from './highlight-types'

/** Keep the user's matching behavior while requesting exact capture offsets. */
export function compileHighlightRegex(pattern: string, flags: string): RegExp | null {
  if (!pattern) return null
  try {
    // Validate the original flags first, including duplicate flags.
    const regex = new RegExp(pattern, flags)
    return regex.hasIndices ? regex : new RegExp(regex.source, `${regex.flags}d`)
  } catch {
    return null
  }
}

function splitOverlaps(spans: HighlightSpan[]): HighlightSpan[] {
  const boundaries = [...new Set(spans.flatMap(({ start, end }) => [start, end]))].sort((a, b) => a - b)
  const result: HighlightSpan[] = []

  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index]
    const end = boundaries[index + 1]
    let winner: HighlightSpan | undefined
    for (const span of spans) {
      if (span.start <= start && span.end >= end && (!winner || (span.group ?? 0) > (winner.group ?? 0))) {
        winner = span
      }
    }
    if (!winner) continue

    const previous = result.at(-1)
    if (previous && previous.end === start && previous.kind === winner.kind && previous.group === winner.group) {
      previous.end = end
    } else {
      result.push({ ...winner, start, end })
    }
  }

  return result
}

/**
 * Produce disjoint ranges for matches and their captures. Capture indices avoid
 * confusing repeated text with the substring that actually matched a group.
 * Later-numbered (inner) captures take precedence where ranges overlap.
 */
export function getMatchHighlights(filename: string, regex: RegExp | null): HighlightSpan[] {
  if (!regex) return []
  // Each file starts at zero without changing the caller's RegExp.lastIndex.
  const matcher = compileHighlightRegex(regex.source, regex.flags)
  if (!matcher) return []

  const spans: HighlightSpan[] = []
  let match: RegExpExecArray | null
  while ((match = matcher.exec(filename)) !== null) {
    match.indices?.forEach((range, group) => {
      if (!range || range[0] === range[1]) return
      spans.push(group === 0
        ? { start: range[0], end: range[1], kind: 'match', label: 'Full match' }
        : { start: range[0], end: range[1], kind: 'group', group, label: `Capture group ${group}` })
    })
    if (!matcher.global) break

    if (match[0].length === 0) {
      // exec does not advance after empty matches. Advance by a code point in
      // Unicode mode so a surrogate pair cannot send the next match backward.
      const unicode = matcher.unicode || matcher.flags.includes('v')
      const codePoint = filename.codePointAt(matcher.lastIndex)
      matcher.lastIndex += unicode && codePoint !== undefined && codePoint > 0xffff ? 2 : 1
    }
  }

  return splitOverlaps(spans)
}

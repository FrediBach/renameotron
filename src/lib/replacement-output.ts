import { metadataHighlight, type HighlightSpan } from './highlight-types'
import { scanMetadataTokens } from './metadata-pattern'
import { captureLabel, tokenizeRegex } from './pattern-highlights'

interface ExpandedReplacement {
  text: string
  metadata: HighlightSpan[]
}

type Highlight = Omit<HighlightSpan, 'start' | 'end'>

/** Resolve metadata once, recording its origin before JavaScript substitutions. */
export function expandReplacementMetadata(
  replacement: string,
  resolve: (key: string, format: string | undefined, modifiers: string[]) => string,
): ExpandedReplacement {
  let text = ''
  const metadata: HighlightSpan[] = []
  let cursor = 0
  for (const token of scanMetadataTokens(replacement, true)) {
    if (token.error) throw new Error(token.error)
    if (!token.complete) continue
    text += replacement.slice(cursor, token.start)
    // Dollar signs in metadata must remain literal when String.replace runs.
    const value = resolve(token.key, token.format, token.modifiers).split('$').join('$$')
    const start = text.length
    text += value
    if (value) metadata.push({ ...metadataHighlight(token.key), start, end: text.length })
    cursor = token.end
  }
  text += replacement.slice(cursor)
  return { text, metadata }
}

/**
 * Trace the origin of generated text, never search for values in the result.
 * Native String.replace remains authoritative: an uncertain trace returns no
 * highlights and cannot affect the destination name or rename validation.
 */
export function getReplacementOutputHighlights(
  input: string,
  regex: RegExp,
  replacement: ExpandedReplacement,
  nativeOutput: string,
): HighlightSpan[] {
  const { text, metadata } = replacement
  const owners: Array<Highlight | undefined> = new Array(text.length)
  for (const span of metadata) {
    const owner = metadataHighlight(span.token!)
    owners.fill(owner, span.start, span.end)
  }
  const { groups } = tokenizeRegex(regex.source)
  const spans: HighlightSpan[] = []
  let delta = 0

  const tracedOutput = input.replace(new RegExp(regex.source, regex.flags), (...args: unknown[]) => {
    // The final callback argument is named captures only when they exist.
    const named = typeof args.at(-1) === 'object' ? args.at(-1) as Record<string, string | undefined> : undefined
    const offset = args[named ? args.length - 3 : args.length - 2] as number
    const captures = args.slice(1, named ? -3 : -2) as Array<string | undefined>
    const match = args[0] as string
    const outputStart = offset + delta
    let result = ''

    const append = (value: string, highlight?: Highlight) => {
      const start = outputStart + result.length
      result += value
      if (!value || !highlight) return
      const end = outputStart + result.length
      const previous = spans.at(-1)
      if (previous && previous.end === start && previous.kind === highlight.kind && previous.group === highlight.group && previous.token === highlight.token && previous.label === highlight.label) {
        previous.end = end
      } else spans.push({ ...highlight, start, end })
    }

    const appendSubstitution = (start: number, length: number, value: string, highlight?: Highlight) => {
      const owner = owners[start]
      const sourceOwners = owners.slice(start, start + length)
      // Metadata's escaped $$ belongs to that token. A substitution assembled
      // across a metadata boundary (e.g. ${index}) has ambiguous provenance.
      const sameOwner = sourceOwners.every(candidate => candidate === owner)
      append(value, sameOwner ? owner ?? highlight : undefined)
    }

    for (let cursor = 0; cursor < text.length;) {
      if (text[cursor] !== '$' || cursor + 1 === text.length) {
        append(text[cursor], owners[cursor])
        cursor++
        continue
      }

      const next = text[cursor + 1]
      const simple = next === '$' ? { value: '$', highlight: { kind: 'escape', label: 'Literal dollar sign' } as Highlight }
        : next === '&' ? { value: match, highlight: { kind: 'match', label: 'Full match' } as Highlight }
          : next === '`' ? { value: input.slice(0, offset), highlight: { kind: 'escape', label: 'Text before the match' } as Highlight }
            : next === "'" ? { value: input.slice(offset + match.length), highlight: { kind: 'escape', label: 'Text after the match' } as Highlight }
              : undefined
      if (simple) {
        appendSubstitution(cursor, 2, simple.value, simple.highlight)
        cursor += 2
        continue
      }

      if (next === '<' && named) {
        const end = text.indexOf('>', cursor + 2)
        if (end !== -1) {
          const name = text.slice(cursor + 2, end)
          const group = groups.find(candidate => candidate.name === name)
          appendSubstitution(cursor, end + 1 - cursor, named[name] ?? '', group ? { kind: 'group', group: group.index, label: captureLabel(group) } : undefined)
          cursor = end + 1
          continue
        }
      }

      if (/\d/.test(next)) {
        const twoDigits = text.slice(cursor + 1, cursor + 3)
        const twoDigitIndex = /^\d{2}$/.test(twoDigits) ? Number(twoDigits) : 0
        const oneDigitIndex = Number(next)
        const group = twoDigitIndex > 0 && twoDigitIndex <= captures.length ? twoDigitIndex
          : oneDigitIndex > 0 && oneDigitIndex <= captures.length ? oneDigitIndex : 0
        if (group) {
          const length = group === twoDigitIndex ? 3 : 2
          appendSubstitution(cursor, length, captures[group - 1] ?? '', { kind: 'group', group, label: captureLabel(groups[group - 1] ?? { index: group }) })
          cursor += length
          continue
        }
      }

      // Unknown capture references and an isolated dollar remain literal.
      append('$', owners[cursor])
      cursor++
    }

    delta += result.length - match.length
    return result
  })

  return tracedOutput === nativeOutput ? spans : []
}

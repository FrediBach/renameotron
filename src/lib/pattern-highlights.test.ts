import { describe, expect, it } from 'vitest'
import { tokenizeRegex, tokenizeReplacement } from './pattern-highlights'

describe('pattern syntax highlighting', () => {
  it('colors screenshot capture delimiters with their actual group numbers', () => {
    const pattern = '^IMG_(\\d+)\\.(jpg|png)$'
    const result = tokenizeRegex(pattern)
    expect(result.groups).toEqual([{ index: 1 }, { index: 2 }])
    expect(result.spans.filter(span => span.kind === 'group').map(span => [pattern.slice(span.start, span.end), span.group])).toEqual([
      ['(', 1], [')', 1], ['(', 2], [')', 2],
    ])
    expect(result.spans.filter(span => span.kind === 'syntax').map(span => pattern.slice(span.start, span.end))).toEqual(['^', '+', '|', '$'])
  })

  it('numbers nested and named captures while ignoring character classes and noncapturing groups', () => {
    const pattern = '\\([()]+(?:x)(?=y)(?<=z)(?<name>(a))\\)'
    const { groups, spans } = tokenizeRegex(pattern)
    expect(groups).toEqual([{ index: 1, name: 'name' }, { index: 2 }])
    expect(spans.filter(span => span.kind === 'group').map(span => [pattern.slice(span.start, span.end), span.group])).toEqual([
      ['(?<name>', 1], ['(', 2], [')', 2], [')', 1],
    ])
  })

  it('handles escaped character-class terminators and unfinished input without inventing captures', () => {
    expect(tokenizeRegex('[\\]()](x)').groups).toEqual([{ index: 1 }])
    expect(tokenizeRegex('[abc(').groups).toEqual([])
    expect(tokenizeRegex('(?<name>a)(b').groups).toEqual([{ index: 1, name: 'name' }, { index: 2 }])
    expect(tokenizeRegex('\\').spans).toEqual([{ start: 0, end: 1, kind: 'escape', label: 'Escape or character class' }])
  })

  it('shares colors with numeric and named regex backreferences', () => {
    const pattern = '(?<first>a)(b)\\1\\2\\k<first>'
    const { spans } = tokenizeRegex(pattern)
    expect(spans.filter(span => pattern[span.start] === '\\').map(span => span.group)).toEqual([1, 2, 1])
  })

  it('keeps syntax-only groups separate from capture numbering', () => {
    const { groups } = tokenizeRegex('(?!(x))(?<=(y))(?:(z))')
    expect(groups.map(group => group.index)).toEqual([1, 2, 3])
  })

  it('keeps named captures with Unicode escapes connected to backreferences', () => {
    const pattern = '(?<\\u0061>x)\\k<a>'
    const { groups, spans } = tokenizeRegex(pattern)
    expect(groups).toEqual([{ index: 1, name: 'a' }])
    expect(spans.at(-1)?.group).toBe(1)
  })
})

describe('replacement syntax highlighting', () => {
  const groups = [{ index: 1, name: 'number' }, { index: 2 }]

  it('uses matching capture colors for numbered and named references', () => {
    const replacement = '$2-$1-$<number>-{index:3}.$&'
    expect(tokenizeReplacement(replacement, groups).map(span => [replacement.slice(span.start, span.end), span.kind, span.group])).toEqual([
      ['$2', 'group', 2], ['$1', 'group', 1], ['$<number>', 'group', 1], ['{index:3}', 'metadata', undefined], ['$&', 'match', undefined],
    ])
  })

  it('follows JS numeric-reference fallback instead of inventing groups', () => {
    const replacement = '$12-$02-$99-$0'
    expect(tokenizeReplacement(replacement, groups).map(span => [replacement.slice(span.start, span.end), span.group])).toEqual([
      ['$1', 1], ['$02', 2],
    ])
  })

  it('does not mistake escaped dollar signs or nonexistent groups for captures', () => {
    const replacement = '$$1-$9-$<absent>'
    expect(tokenizeReplacement(replacement, groups).map(span => [replacement.slice(span.start, span.end), span.kind])).toEqual([['$$', 'escape']])
    expect(tokenizeReplacement('$1', [])).toEqual([])
    expect(tokenizeReplacement('$<\\u0061>', [{ index: 1, name: 'a' }])).toEqual([])
  })

  it('keeps incomplete metadata highlighted while typing', () => {
    const replacement = 'photo-{mod'
    expect(tokenizeReplacement(replacement, groups)).toEqual([{ start: 6, end: 10, kind: 'metadata', label: 'Metadata: mod' }])
  })
})

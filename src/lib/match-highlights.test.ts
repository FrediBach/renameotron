import { describe, expect, it } from 'vitest'
import { compileHighlightRegex, getMatchHighlights } from './match-highlights'

function highlights(filename: string, pattern: string, flags = '') {
  return getMatchHighlights(filename, compileHighlightRegex(pattern, flags))
    .map(({ start, end, kind, group }) => [filename.slice(start, end), kind, group ?? 0])
}

describe('compileHighlightRegex', () => {
  it('requests indices and preserves matching flags', () => {
    const regex = compileHighlightRegex('IMG', 'ig')
    expect(regex?.flags).toBe('dgi')
    expect(regex?.source).toBe('IMG')
    expect(compileHighlightRegex('IMG', 'd')?.flags).toBe('d')
  })

  it.each([['', ''], ['[', ''], ['a', 'ii'], ['a', 'dd'], ['a', 'invalid']])('ignores empty or invalid patterns and flags (%j, %j)', (pattern, flags) => {
    expect(compileHighlightRegex(pattern, flags)).toBeNull()
    expect(getMatchHighlights('a.jpg', compileHighlightRegex(pattern, flags))).toEqual([])
  })
})

describe('getMatchHighlights', () => {
  it('colors the full match and its two capture groups as in the filename example', () => {
    expect(highlights('IMG_1042.jpg', '^IMG_(\\d+)\\.(jpg|png)$')).toEqual([
      ['IMG_', 'match', 0], ['1042', 'group', 1], ['.', 'match', 0], ['jpg', 'group', 2],
    ])
  })

  it('leaves unmatched prefixes, suffixes, and filenames unmarked', () => {
    const regex = compileHighlightRegex('IMG_(\\d+)', '')
    expect(getMatchHighlights('copy-IMG_1042.jpg', regex)).toEqual([
      { start: 5, end: 9, kind: 'match', label: 'Full match' },
      { start: 9, end: 13, kind: 'group', group: 1, label: 'Capture group 1' },
    ])
    expect(getMatchHighlights('notes.md', regex)).toEqual([])
  })

  it('highlights only the first occurrence unless global matching is enabled', () => {
    expect(highlights('a1-a2-a3', 'a(\\d)')).toEqual([
      ['a', 'match', 0], ['1', 'group', 1],
    ])
    expect(highlights('a1-a2-a3', 'a(\\d)', 'g')).toEqual([
      ['a', 'match', 0], ['1', 'group', 1],
      ['a', 'match', 0], ['2', 'group', 1],
      ['a', 'match', 0], ['3', 'group', 1],
    ])
  })

  it('respects case sensitivity and the ignore-case flag', () => {
    expect(highlights('IMG.jpg', 'img')).toEqual([])
    expect(highlights('IMG.jpg', 'img', 'i')).toEqual([['IMG', 'match', 0]])
  })

  it('uses capture offsets when identical text appears multiple times', () => {
    expect(highlights('foo-foo-foo', '^(foo)-foo-(foo)$')).toEqual([
      ['foo', 'group', 1], ['-foo-', 'match', 0], ['foo', 'group', 2],
    ])
    expect(highlights('abab', '^(ab)+$')).toEqual([
      ['ab', 'match', 0], ['ab', 'group', 1],
    ])
  })

  it('lets nested captures override the enclosing capture', () => {
    expect(highlights('abcd', '^(a(b(c))d)$')).toEqual([
      ['a', 'group', 1], ['b', 'group', 2], ['c', 'group', 3], ['d', 'group', 1],
    ])
    expect(highlights('abc', '^((abc))$')).toEqual([['abc', 'group', 2]])
  })

  it('keeps capture numbering when optional groups or alternative branches do not match', () => {
    expect(highlights('bc', '^(a)?b(c)$')).toEqual([
      ['b', 'match', 0], ['c', 'group', 2],
    ])
    expect(highlights('ab', '(a)|(b)', 'g')).toEqual([
      ['a', 'group', 1], ['b', 'group', 2],
    ])
  })

  it('treats named captures as their numeric group', () => {
    expect(highlights('IMG_42.jpg', '^(?<prefix>IMG)_(?<number>\\d+)')).toEqual([
      ['IMG', 'group', 1], ['_', 'match', 0], ['42', 'group', 2],
    ])
  })

  it('supports captures outside the full match in lookarounds', () => {
    expect(highlights('ab', '(?=(a))')).toEqual([['a', 'group', 1]])
    expect(highlights('ab', '(?<=(a))b')).toEqual([
      ['a', 'group', 1], ['b', 'match', 0],
    ])
    expect(highlights('abc', '(?=(a(b)))', 'g')).toEqual([
      ['a', 'group', 1], ['b', 'group', 2],
    ])
  })

  it('splits overlapping lookahead captures into sorted disjoint ranges', () => {
    expect(getMatchHighlights('abc', compileHighlightRegex('(?=(.(.)))', 'g'))).toEqual([
      { start: 0, end: 1, kind: 'group', group: 1, label: 'Capture group 1' },
      { start: 1, end: 3, kind: 'group', group: 2, label: 'Capture group 2' },
    ])
  })

  it('terminates on zero-width matches without returning empty spans', () => {
    expect(highlights('a.jpg', '(?:)', 'g')).toEqual([])
    expect(highlights('a.jpg', '^|$', 'g')).toEqual([])
    expect(highlights('a', '()a()')).toEqual([['a', 'match', 0]])
    expect(highlights('', '(?:)', 'g')).toEqual([])
  })

  it('advances zero-width Unicode matches by whole code points', () => {
    expect(getMatchHighlights('😀x', compileHighlightRegex('(?=(.))', 'gu'))).toEqual([
      { start: 0, end: 3, kind: 'group', group: 1, label: 'Capture group 1' },
    ])
    expect(highlights('😀x', '(?:)', 'gu')).toEqual([])
  })

  it('starts each filename at zero and preserves the supplied regex state', () => {
    const regex = /a(\d)/g
    regex.lastIndex = 3
    const expected = [
      { start: 0, end: 1, kind: 'match', label: 'Full match' },
      { start: 1, end: 2, kind: 'group', group: 1, label: 'Capture group 1' },
    ]
    expect(getMatchHighlights('a1.jpg', regex)).toEqual(expected)
    expect(getMatchHighlights('a1.jpg', regex)).toEqual(expected)
    expect(regex.lastIndex).toBe(3)
  })
})

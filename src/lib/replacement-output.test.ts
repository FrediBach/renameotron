import { describe, expect, it, vi } from 'vitest'
import { buildRenamePlan, type FileEntry, type RenameRow } from './rename'
import { expandReplacementMetadata, getReplacementOutputHighlights } from './replacement-output'

function file(name: string, overrides: Partial<FileEntry> = {}): FileEntry {
  return { id: name, name, path: name, size: 1280, type: 'image/jpeg', lastModified: Date.UTC(2025, 3, 12, 14, 5, 9), metadata: {}, ...overrides }
}

function parts(row: RenameRow) {
  return row.targetHighlights?.map(({ start, end, kind, token, group }) => ({
    text: row.targetPath.slice(start, end), start, end, kind,
    ...(token ? { token } : {}), ...(group ? { group } : {}),
  })) ?? []
}

describe('metadata expression expansion', () => {
  it('resolves each complete token once with legacy formats and its ordered modifier chain', () => {
    const resolve = vi.fn().mockReturnValueOnce('001x').mockReturnValueOnce('name')
    expect(expandReplacementMetadata('{index:3|suffix("x")}-{name|trim|lower}', resolve).text).toBe('001x-name')
    expect(resolve.mock.calls).toEqual([
      ['index', '3', ['suffix("x")']],
      ['name', undefined, ['trim', 'lower']],
    ])
  })

  it('passes quoted delimiters literally and never expands metadata inside arguments or results', () => {
    const resolve = vi.fn(() => '$1-$&-{ext}')
    const expanded = expandReplacementMetadata('{name|replace("{ext}|a,b:c","$1-$&")}', resolve)
    expect(resolve.mock.calls).toEqual([['name', undefined, ['replace("{ext}|a,b:c","$1-$&")']]])
    const output = 'a.jpg'.replace(/^.+$/, expanded.text)
    expect(output).toBe('$1-$&-{ext}')
    expect(getReplacementOutputHighlights('a.jpg', /^.+$/, expanded, output)).toEqual([
      { start: 0, end: output.length, kind: 'metadata', token: 'name', label: 'Metadata: name' },
    ])
  })

  it('rejects broken modifier expressions before resolving their values', () => {
    const resolve = vi.fn(() => 'value')
    for (const replacement of ['{name|}', '{name|replace("{ext}","x"}', '{name|replace("{ext}', '{name|lower', '{name|replace({ext},"x")}']) {
      expect(() => expandReplacementMetadata(replacement, resolve)).toThrow()
    }
    expect(resolve).not.toHaveBeenCalled()
  })

  it('leaves ordinary unmatched braces unchanged', () => {
    const resolve = vi.fn(() => 'value')
    for (const replacement of ['{', 'before {name', '{modified:YYYY-MM-DD', '{some literal words}', '{123}']) {
      expect(expandReplacementMetadata(replacement, resolve)).toEqual({ text: replacement, metadata: [] })
    }
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('replacement output highlights', () => {
  it('colors only inserted metadata even when literals have the identical value', () => {
    const [row] = buildRenamePlan([file('photo.jpg')], '^.+$', 'jpg-{ext}.jpg', '').rows
    expect(row.targetPath).toBe('jpg-jpg.jpg')
    expect(parts(row)).toEqual([{ text: 'jpg', start: 4, end: 7, kind: 'metadata', token: 'ext' }])
  })

  it('tracks repeated metadata separately and accounts for preserved source folders', () => {
    const [row] = buildRenamePlan([file('a.jpg', { path: 'raw/a.jpg' })], '^.+$', '{ext}-{name}-{ext}-{index:3}.jpg', '').rows
    expect(row.targetPath).toBe('raw/jpg-a-jpg-001.jpg')
    expect(parts(row)).toEqual([
      { text: 'jpg', start: 4, end: 7, kind: 'metadata', token: 'ext' },
      { text: 'a', start: 8, end: 9, kind: 'metadata', token: 'name' },
      { text: 'jpg', start: 10, end: 13, kind: 'metadata', token: 'ext' },
      { text: '001', start: 14, end: 17, kind: 'metadata', token: 'index' },
    ])
  })

  it('highlights formatted dates and generated folders relative to the selected root', () => {
    const [row] = buildRenamePlan([file('photo.jpg', { path: 'raw/photo.jpg' })], '^.+$', '{modified:YYYY-MM}/{index:3}.{ext}', '').rows
    expect(row.targetPath).toBe('2025-04/001.jpg')
    expect(parts(row)).toEqual([
      { text: '2025-04', start: 0, end: 7, kind: 'metadata', token: 'modified' },
      { text: '001', start: 8, end: 11, kind: 'metadata', token: 'index' },
      { text: 'jpg', start: 12, end: 15, kind: 'metadata', token: 'ext' },
    ])
  })

  it('keeps captures, full matches, and metadata distinct in the generated name', () => {
    const [row] = buildRenamePlan([file('IMG_42.jpg')], '^IMG_(?<number>\\d+)\\.(jpg)$', '$<number>-$2-{ext}-$&', '').rows
    expect(row.targetPath).toBe('42-jpg-jpg-IMG_42.jpg')
    expect(parts(row)).toEqual([
      { text: '42', start: 0, end: 2, kind: 'group', group: 1 },
      { text: 'jpg', start: 3, end: 6, kind: 'group', group: 2 },
      { text: 'jpg', start: 7, end: 10, kind: 'metadata', token: 'ext' },
      { text: 'IMG_42.jpg', start: 11, end: 21, kind: 'match' },
    ])
  })

  it('leaves unmodified source text plain and repeats spans for every global replacement', () => {
    const [row] = buildRenamePlan([file('a-a.jpg')], '(a)', '$1{index:2}', 'g').rows
    expect(row.targetPath).toBe('a01-a01.jpg')
    expect(parts(row)).toEqual([
      { text: 'a', start: 0, end: 1, kind: 'group', group: 1 },
      { text: '01', start: 1, end: 3, kind: 'metadata', token: 'index' },
      { text: 'a', start: 4, end: 5, kind: 'group', group: 1 },
      { text: '01', start: 5, end: 7, kind: 'metadata', token: 'index' },
    ])
  })

  it('uses UTF-16 offsets and native zero-width advancement in Unicode mode', () => {
    const [row] = buildRenamePlan([file('😀a')], '(?=.)', '{index}', 'gu').rows
    expect(row.targetPath).toBe('1😀1a')
    expect(parts(row)).toEqual([
      { text: '1', start: 0, end: 1, kind: 'metadata', token: 'index' },
      { text: '1', start: 3, end: 4, kind: 'metadata', token: 'index' },
    ])
  })

  it('follows numeric capture fallback and omits unmatched captures', () => {
    const [row] = buildRenamePlan([file('a.jpg')], '^(a)(b)?\\.jpg$', '$12-$01-$2-{ext}', '').rows
    expect(row.targetPath).toBe('a2-a--jpg')
    expect(parts(row)).toEqual([
      { text: 'a', start: 0, end: 1, kind: 'group', group: 1 },
      { text: 'a', start: 3, end: 4, kind: 'group', group: 1 },
      { text: 'jpg', start: 6, end: 9, kind: 'metadata', token: 'ext' },
    ])
  })

  it('keeps replacement syntax inside metadata literal and in its metadata color', () => {
    const [row] = buildRenamePlan([file('a.jpg', { metadata: { camera: '$&-$1-{ext}' } })], '^.+$', '{camera}.{ext}', '').rows
    expect(row.targetPath).toBe('$&-$1-{ext}.jpg')
    expect(parts(row)).toEqual([
      { text: '$&-$1-{ext}', start: 0, end: 11, kind: 'metadata', token: 'camera' },
      { text: 'jpg', start: 12, end: 15, kind: 'metadata', token: 'ext' },
    ])
  })

  it('keeps native substitution semantics when a metadata value forms a capture reference', () => {
    const [row] = buildRenamePlan([file('a.jpg')], '^(a)\\.jpg$', '${index}-{ext}', '').rows
    expect(row.targetPath).toBe('a-jpg')
    expect(parts(row)).toEqual([{ text: 'jpg', start: 2, end: 5, kind: 'metadata', token: 'ext' }])
  })

  it('keeps unchanged rows highlighted and skips unselected or unmatched files', () => {
    const files = [file('a.jpg'), file('b.jpg'), file('c.png')]
    const plan = buildRenamePlan(files, '^.+\\.jpg$', '{name}.{ext}', '', new Set(['a.jpg', 'c.png']))
    expect(plan.rows.map(row => row.status)).toEqual(['unchanged', 'unmatched', 'unmatched'])
    expect(parts(plan.rows[0])).toEqual([
      { text: 'a', start: 0, end: 1, kind: 'metadata', token: 'name' },
      { text: 'jpg', start: 2, end: 5, kind: 'metadata', token: 'ext' },
    ])
    expect(parts(plan.rows[1])).toEqual([])
    expect(parts(plan.rows[2])).toEqual([])
  })

  it('handles escaped dollars and text-before/text-after substitutions', () => {
    const [row] = buildRenamePlan([file('a-b.jpg')], 'b', "$$-$`-$'-{index}", '').rows
    expect(row.targetPath).toBe('a-$-a--.jpg-1.jpg')
    expect(parts(row)).toEqual([
      { text: '$', start: 2, end: 3, kind: 'escape' },
      { text: 'a-', start: 4, end: 6, kind: 'escape' },
      { text: '.jpg', start: 7, end: 11, kind: 'escape' },
      { text: '1', start: 12, end: 13, kind: 'metadata', token: 'index' },
    ])
  })

  it('colors path metadata and keeps unknown or missing metadata errors', () => {
    const [row] = buildRenamePlan([file('photo.jpg')], '^.+$', '{type}/{name}.{ext}', '').rows
    expect(row.targetPath).toBe('image/jpeg/photo.jpg')
    expect(parts(row)[0]).toEqual({ text: 'image/jpeg', start: 0, end: 10, kind: 'metadata', token: 'type' })
    for (const token of ['unknown', 'camera']) {
      const [invalid] = buildRenamePlan([file('photo.jpg')], '^.+$', `{${token}}`, '').rows
      expect(invalid.status).toBe('error')
      expect(parts(invalid)).toEqual([])
    }
  })

  it('discards highlights when the trace does not equal the authoritative output', () => {
    const expanded = expandReplacementMetadata('{ext}', () => 'jpg')
    expect(getReplacementOutputHighlights('a.jpg', /^.+$/, expanded, 'different.jpg')).toEqual([])
  })
})

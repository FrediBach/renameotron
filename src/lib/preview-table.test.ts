import { describe, expect, it } from 'vitest'
import { buildRenamePlan, formatBytes, TOKEN_DEFINITIONS, type FileEntry } from './rename'
import { buildPreviewRecords, getPreviewColumns, selectPreviewRecords, type PreviewSelectionOptions } from './preview-table'

function file(name: string, overrides: Partial<FileEntry> = {}): FileEntry {
  return { id: name, name, path: name, size: 1280, type: 'image/jpeg', lastModified: Date.UTC(2025, 3, 12, 14, 5, 9), metadata: {}, ...overrides }
}

function preview(files: FileEntry[], pattern = '^.+$', selectedIds = new Set(files.map(file => file.id))) {
  const plan = buildRenamePlan(files, pattern, '{index:3}-{name}.{ext}', 'i', selectedIds)
  return buildPreviewRecords(plan.rows, selectedIds)
}

function select(records: ReturnType<typeof preview>, options: Partial<PreviewSelectionOptions> = {}) {
  return selectPreviewRecords(records, { search: '', filters: {}, sort: null, matchedOnly: false, ...options })
}

describe('preview columns and values', () => {
  it('offers every rename token and discovers additional metadata without duplicate columns', () => {
    const columns = getPreviewColumns([
      file('one.jpg', { metadata: { camera: 'Camera', lensModel: '35mm', iso: 200 } }),
      file('two.jpg', { metadata: { lensModel: '50mm', exposure_time: '1/200' } }),
    ])
    expect(columns.map(column => column.id)).toEqual(expect.arrayContaining(['from', 'to', 'status', ...TOKEN_DEFINITIONS.map(token => token.key), 'metadata:lensModel', 'metadata:iso', 'metadata:exposure_time']))
    expect(new Set(columns.map(column => column.id)).size).toBe(columns.length)
    expect(columns.some(column => column.id === 'metadata:camera')).toBe(false)
    expect(columns.find(column => column.id === 'metadata:lensModel')?.label).toBe('Lens Model')
    expect(getPreviewColumns([]).map(column => column.id)).toEqual(expect.arrayContaining(TOKEN_DEFINITIONS.map(token => token.key)))
  })

  it('uses full UTC dates, readable sizes, calculated metadata, and explicit missing values', () => {
    const records = preview([
      file('photo.jpg', { size: 2_400_000, metadata: { taken: '2026-10-12T10:24:35+02:00', camera: 'X100VI', width: 6240, height: 4160, iso: 200 } }),
      file('README', { size: 0, type: '', lastModified: NaN, metadata: { taken: 'invalid' } }),
    ])
    expect(records[0].values.taken).toEqual({ text: '2026-10-12 08:24:35 UTC', sortValue: Date.parse('2026-10-12T08:24:35Z') })
    expect(records[0].values.modified.text).toBe('2025-04-12 14:05:09 UTC')
    expect(records[0].values.size.text).toBe(formatBytes(2_400_000))
    expect(records[0].values.dimensions.text).toBe('6240x4160')
    expect(records[0].values.aspect.text).toBe('3x2')
    expect(records[0].values.megapixels.sortValue).toBe(25.96)
    expect(records[0].values['metadata:iso'].sortValue).toBe(200)
    expect(records[1].values.ext).toEqual({ text: 'No extension', sortValue: '' })
    expect(records[1].values.size).toMatchObject({ text: '0 B', sortValue: 0 })
    for (const key of ['taken', 'modified', 'camera', 'type', 'dimensions', 'metadata:iso']) {
      expect(records[1].values[key]).toMatchObject({ text: '—', sortValue: null })
    }
  })

  it('keeps original selected-match sequence numbers when the view is filtered or sorted', () => {
    const files = [file('photo10.jpg'), file('notes.md'), file('photo2.jpg'), file('photo1.jpg')]
    const records = preview(files, '^.*\\.jpg$', new Set(['photo10.jpg', 'notes.md', 'photo1.jpg']))
    expect(records.map(record => record.values.index.sortValue)).toEqual([1, null, null, 2])
    expect(records.map(record => record.values.status.text)).toEqual(['Ready', 'No match', 'Excluded', 'Ready'])
    const sorted = select(records, { matchedOnly: true, sort: { columnId: 'from', direction: 'asc' } })
    expect(sorted.map(record => [record.row.file.name, record.values.index.text, record.row.targetPath])).toEqual([
      ['photo1.jpg', '2', '002-photo1.jpg'],
      ['photo10.jpg', '1', '001-photo10.jpg'],
    ])
    expect(select(records, { search: 'photo1.jpg' })[0].values.index.text).toBe('2')
    expect(records.map(record => record.row.file.name)).toEqual(files.map(file => file.name))
  })

  it('counts unchanged and errored matches in the canonical sequence and searches error details', () => {
    const files = [file('unchanged.jpg', { metadata: { camera: 'unchanged.jpg' } }), file('bad.jpg', { metadata: { camera: '../invalid' } }), file('good.jpg', { metadata: { camera: 'renamed.jpg' } })]
    const selected = new Set(files.map(file => file.id))
    const plan = buildRenamePlan(files, '^.+$', '{camera}', 'i', selected)
    const records = buildPreviewRecords(plan.rows, selected)
    expect(records.map(record => record.values.status.text)).toEqual(['Unchanged', 'Error', 'Ready'])
    expect(records.map(record => record.values.index.sortValue)).toEqual([1, 2, 3])
    expect(select(records, { search: 'Paths cannot contain' }).map(record => record.row.file.name)).toEqual(['bad.jpg'])
    expect(select(records, { filters: { to: 'Paths cannot contain' } }).map(record => record.row.file.name)).toEqual(['bad.jpg'])
  })
})

describe('preview search and sorting', () => {
  it('filters and sorts the To column by the displayed no-match and excluded labels', () => {
    const records = preview([file('z.jpg'), file('b.txt'), file('a.jpg')], '^.*\\.jpg$', new Set(['z.jpg', 'b.txt']))
    expect(records.map(record => record.values.to.text)).toEqual(['001-z.jpg', 'No match', 'Excluded'])
    expect(select(records, { filters: { to: 'no match' } }).map(record => record.row.file.name)).toEqual(['b.txt'])
    expect(select(records, { filters: { to: 'excluded' } }).map(record => record.row.file.name)).toEqual(['a.jpg'])
    expect(select(records, { sort: { columnId: 'to', direction: 'asc' } }).map(record => record.row.file.name)).toEqual(['z.jpg', 'a.jpg', 'b.txt'])
    expect(select(records, { sort: { columnId: 'to', direction: 'desc' } }).map(record => record.row.file.name)).toEqual(['b.txt', 'a.jpg', 'z.jpg'])
    expect(select(records, { search: 'a.jpg' }).map(record => record.row.file.name)).toEqual(['a.jpg'])
    expect(records[2].row.targetPath).toBe('a.jpg')
  })

  it('searches hidden metadata and raw bytes while combining independent column filters', () => {
    const records = preview([
      file('one.jpg', { size: 2_400_000, metadata: { camera: 'Fujifilm X100VI', width: 6240, height: 4160, lensModel: 'Summilux' } }),
      file('two.jpg', { metadata: { camera: 'Fujifilm X100VI', width: 4160, height: 6240 } }),
      file('three.jpg', { metadata: { camera: 'Sony A7', width: 6240, height: 4160 } }),
    ])
    expect(select(records, { search: 'SUMMILUX' }).map(record => record.row.file.name)).toEqual(['one.jpg'])
    expect(select(records, { search: '2400000' }).map(record => record.row.file.name)).toEqual(['one.jpg'])
    expect(select(records, { search: 'jpg', filters: { camera: '  fUJIfilm  ', orientation: 'landscape', from: 'one', ext: '  ' } }).map(record => record.row.file.name)).toEqual(['one.jpg'])
    expect(select(records, { search: 'sony', filters: { orientation: 'portrait' } })).toEqual([])
    expect(select(records, { filters: { 'metadata:lensModel': 'not available' } }).map(record => record.row.file.name)).toEqual(['two.jpg', 'three.jpg'])
  })

  it('sorts numbers, dates, and filenames naturally with missing values last in both directions', () => {
    const records = preview([
      file('photo10.jpg', { size: 20, metadata: { width: 100, taken: '2026-01-01T01:00:00+02:00', iso: '100' } }),
      file('photo2.jpg', { size: 3, metadata: { width: 9, taken: '2025-12-31T23:30:00Z', iso: '20' } }),
      file('photo1.jpg', { size: 100, metadata: {} }),
    ])
    const names = (columnId: string, direction: 'asc' | 'desc') => select(records, { sort: { columnId, direction } }).map(record => record.row.file.name)
    expect(names('from', 'asc')).toEqual(['photo1.jpg', 'photo2.jpg', 'photo10.jpg'])
    expect(names('size', 'asc')).toEqual(['photo2.jpg', 'photo10.jpg', 'photo1.jpg'])
    expect(names('width', 'asc')).toEqual(['photo2.jpg', 'photo10.jpg', 'photo1.jpg'])
    expect(names('width', 'desc')).toEqual(['photo10.jpg', 'photo2.jpg', 'photo1.jpg'])
    expect(names('taken', 'asc')).toEqual(['photo10.jpg', 'photo2.jpg', 'photo1.jpg'])
    expect(names('taken', 'desc')).toEqual(['photo2.jpg', 'photo10.jpg', 'photo1.jpg'])
    expect(names('metadata:iso', 'asc')).toEqual(['photo2.jpg', 'photo10.jpg', 'photo1.jpg'])
  })

  it('preserves input order for equal values and never mutates the rename plan', () => {
    const files = [file('b.jpg'), file('a.jpg'), file('c.jpg')]
    const selectedIds = new Set(files.map(file => file.id))
    const plan = buildRenamePlan(files, '^.+$', '{index:3}.jpg', 'i', selectedIds)
    const rowsBefore = JSON.stringify(plan.rows)
    const records = buildPreviewRecords(plan.rows, selectedIds)
    for (const direction of ['asc', 'desc'] as const) {
      expect(select(records, { sort: { columnId: 'size', direction } }).map(record => record.row.file.name)).toEqual(['b.jpg', 'a.jpg', 'c.jpg'])
    }
    select(records, { sort: { columnId: 'from', direction: 'asc' } })
    expect(JSON.stringify(plan.rows)).toBe(rowsBefore)
    expect(records.map(record => record.row)).toEqual(plan.rows)
    expect(select(records)).not.toBe(records)
  })
})

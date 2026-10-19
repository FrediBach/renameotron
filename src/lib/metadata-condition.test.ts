import { describe, expect, it } from 'vitest'
import { compileMetadataCondition } from './metadata-condition'
import { compileFileSearch } from './file-search'
import { buildPreviewRecords } from './preview-table'
import { resolveFileToken, type FileEntry } from './rename'

function file(name: string, overrides: Partial<FileEntry> = {}): FileEntry {
  return { id: name, name, path: `originals/${name}`, size: 2_000_000, type: 'image/jpeg', lastModified: Date.UTC(2025, 5, 15), metadata: {}, ...overrides }
}

function matches(query: string, files: FileEntry[]): string[] {
  const condition = compileMetadataCondition(query, resolveFileToken)
  expect(condition.error, query).toBeUndefined()
  return files.filter((file, index) => condition.matches(file, index + 1)).map(file => file.name)
}

describe('source metadata conditions', () => {
  it('distinguishes landscape images from portraits, squares, missing dimensions, and non-images', () => {
    const files = [
      file('landscape.jpg', { metadata: { width: 6000, height: 4000 } }),
      file('portrait.jpg', { metadata: { width: 4000, height: 6000 } }),
      file('square.jpg', { metadata: { width: 1000, height: 1000 } }),
      file('unknown.jpg'),
      file('movie.mp4', { type: 'video/mp4', metadata: { width: 1920, height: 1080 } }),
    ]
    expect(matches('type:image AND orientation:landscape', files)).toEqual(['landscape.jpg'])
    expect(matches('NOT (type:image AND orientation:landscape)', files)).toEqual(['portrait.jpg', 'square.jpg', 'unknown.jpg', 'movie.mp4'])
  })

  it('keeps missing metadata distinct from unequal and zero values', () => {
    const files = [
      file('present.jpg', { metadata: { camera: 'Sony', width: 100, height: 100, iso: 0 } }),
      file('missing.jpg', { size: NaN, lastModified: NaN }),
    ]
    expect(matches('camera!=Canon width!=200 date!=2024 size!=0', files)).toEqual(['present.jpg'])
    expect(matches('NOT camera:Canon', files)).toEqual(['present.jpg', 'missing.jpg'])
    expect(matches('has:metadata.iso metadata.iso=0 has:aspect', files)).toEqual(['present.jpg'])
    expect(matches('-has:camera', files)).toEqual(['missing.jpg'])
  })

  it('uses the provided selected-match index without deriving a new sequence', () => {
    const condition = compileMetadataCondition('index=7', resolveFileToken)
    expect(condition.matches(file('photo.jpg'), 7)).toBe(true)
    expect(condition.matches(file('photo.jpg'), 1)).toBe(false)
  })

  it('requires valid positive whole dimensions for shape conditions', () => {
    const files = [
      file('fractional.jpg', { metadata: { width: 1.5, height: 1 } }),
      file('zero.jpg', { metadata: { width: 100, height: 0 } }),
      file('unsafe.jpg', { metadata: { width: Number.MAX_SAFE_INTEGER + 1, height: 1 } }),
      file('valid.jpg', { metadata: { width: '3', height: '2' } }),
    ]
    expect(matches('orientation:landscape', files)).toEqual(['valid.jpg'])
    expect(matches('has:aspect aspect>1', files)).toEqual(['valid.jpg'])
  })

  it('uses MIME categories and extension fallbacks with the same precedence as search', () => {
    const files = [
      file('photo.JPG', { type: '' }),
      file('raw.NEF', { type: 'application/octet-stream' }),
      file('text.jpg', { type: 'text/plain' }),
      file('unknown.constructor', { type: '' }),
    ]
    expect(matches('type:images', files)).toEqual(['photo.JPG', 'raw.NEF'])
    expect(matches('type:document', files)).toEqual(['text.jpg'])
    expect(matches('-has:type', files)).toEqual(['unknown.constructor'])
  })

  it('matches the original filename including its extension and source path', () => {
    const files = [file('Holiday.JPG'), file('holiday.txt', { type: 'text/plain' })]
    expect(matches('filename="HOLIDAY.JPG" path:originals extension:.jpg', files)).toEqual(['Holiday.JPG'])
    expect(matches('name=Holiday', files)).toEqual([])
  })

  it('short circuits predicates and does not hide unexpected resolver failures', () => {
    const failure = new Error('Unexpected resolver failure')
    const resolver = () => { throw failure }
    expect(compileMetadataCondition('type:video AND has:camera', resolver).matches(file('photo.jpg'), 1)).toBe(false)
    expect(compileMetadataCondition('type:image OR has:camera', resolver).matches(file('photo.jpg'), 1)).toBe(true)
    expect(() => compileMetadataCondition('has:camera', resolver).matches(file('photo.jpg'), 1)).toThrow(failure)
  })
})

describe('condition and file-search compatibility', () => {
  const files = [
    file('summer.jpg', { metadata: { camera: 'Sony A7', width: 6000, height: 4000, taken: '2025-01-01T00:30:00+02:00', lensModel: 'Summilux 35mm', iso: '200' } }),
    file('portrait.JPG', { type: '', size: 1024 ** 2, lastModified: Date.UTC(2024, 1, 29), metadata: { camera: 'Fujifilm X100VI', width: 1080, height: 1920, taken: Date.UTC(2025, 0, 1), iso: 400 } }),
    file('square.png', { type: 'image/png', metadata: { width: 1000, height: 1000, iso: 0 } }),
    file('notes', { type: 'text/plain', lastModified: NaN, metadata: { invalid: NaN, empty: '' } }),
  ]
  const records = buildPreviewRecords(files.map(file => ({ file, targetPath: `results/${file.name}`, status: 'ready' })), new Set(files.map(file => file.id)))

  it.each([
    'type:image (aspect:landscape OR aspect:square) -name:portrait',
    'camera:sony OR camera:fujifilm AND ext:png',
    '(camera:sony OR camera:fujifilm) AND ext:jpg',
    'NOT (orientation:landscape OR orientation:portrait)',
    'width>=1080 height<5000 megapixels>20',
    'aspect:3:2', 'aspect>=16:9', 'aspect!=square', 'has:aspect',
    'dimensions=6000x4000 index=1',
    'filesize>=1MiB size<24 MB', 'size!=1MB',
    'date:2024-02', 'modified>2024', 'taken=2024-12-31', 'taken>=2025',
    'has:taken', 'NOT has:taken', 'date!=2024',
    'metadata.LENSMODEL:summilux', 'metadata.iso>=200 metadata.iso<400',
    'metadata.iso!=400', 'has:metadata.iso',
    'has:metadata.invalid OR has:metadata.empty OR has:metadata.missing',
    'ext=""', 'NOT has:ext', 'path:originals', 'filename="SUMMER.JPG"',
  ])('preserves search results for %s', query => {
    const search = compileFileSearch(query)
    expect(search.error).toBeUndefined()
    expect(matches(query, files)).toEqual(records.filter(search.matches).map(record => record.row.file.name))
  })
})

describe('invalid metadata conditions', () => {
  it.each([
    '', ' ', 'holiday', '"holiday"', 'NOT holiday', 'type:image OR holiday',
    'to:results', 'status:ready', 'has:to', 'NOT has:status', '-to:results',
    'type:image OR (NOT status:error)', 'has:"To"',
    'unknown:yes', 'metadata.:value', 'name:', 'orientation:wide', 'camera>Sony',
    'date:2025-02-29', 'size:-1MB', 'width:many', '(type:image', 'type:image AND',
  ])('reports a positioned error and never matches for %j', query => {
    const condition = compileMetadataCondition(query, resolveFileToken)
    expect(condition.error?.message).toBeTruthy()
    expect(condition.error?.position).toBeGreaterThanOrEqual(0)
    expect(condition.error?.position).toBeLessThanOrEqual(query.length)
    expect(condition.matches(file('photo.jpg'), 1)).toBe(false)
  })

  it('points at forbidden output fields even inside has and negation', () => {
    expect(compileMetadataCondition('NOT has:status', resolveFileToken).error).toMatchObject({ position: 8, message: expect.stringContaining('original file metadata') })
    expect(compileMetadataCondition('type:image OR holiday', resolveFileToken).error).toMatchObject({ position: 14, message: expect.stringContaining('explicit metadata filter') })
  })

  it('retains nesting and input-length limits', () => {
    expect(compileMetadataCondition(`${'('.repeat(100)}type:image${')'.repeat(100)}`, resolveFileToken).error?.message).toMatch(/nested/)
    expect(compileMetadataCondition('a'.repeat(16_385), resolveFileToken).error?.message).toMatch(/16,384/)
  })
})

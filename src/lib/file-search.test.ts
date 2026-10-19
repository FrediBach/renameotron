import { describe, expect, it } from 'vitest'
import { compileFileSearch } from './file-search'
import { buildPreviewRecords, type PreviewRecord } from './preview-table'
import type { FileEntry } from './rename'

function file(name: string, overrides: Partial<FileEntry> = {}): FileEntry {
  return { id: name, name, path: `photos/${name}`, size: 2_000_000, type: 'image/jpeg', lastModified: Date.UTC(2025, 5, 15), metadata: {}, ...overrides }
}

function records(files: FileEntry[]): PreviewRecord[] {
  return buildPreviewRecords(files.map(file => ({ file, targetPath: `renamed/${file.name}`, status: 'ready' })), new Set(files.map(file => file.id)))
}

function names(query: string, input: PreviewRecord[]): string[] {
  const compiled = compileFileSearch(query)
  expect(compiled.error, query).toBeUndefined()
  return input.filter(compiled.matches).map(record => record.row.file.name)
}

describe('composable file search', () => {
  const input = records([
    file('summer holiday.jpg', { metadata: { camera: 'Sony A7', width: 6000, height: 4000 } }),
    file('summer portrait.jpg', { metadata: { camera: 'Fujifilm X100VI', width: 4000, height: 6000 } }),
    file('winter holiday.png', { type: 'image/png', metadata: { camera: 'Fujifilm X100VI', width: 1000, height: 1000 } }),
    file('notes.txt', { type: 'text/plain' }),
  ])

  it('keeps ordinary case-insensitive free text and searches separate words across columns', () => {
    expect(names('', input)).toHaveLength(4)
    expect(names('   ', input)).toHaveLength(4)
    expect(names('HOLIDAY sony', input)).toEqual(['summer holiday.jpg'])
    expect(names('summer holiday', input)).toEqual(['summer holiday.jpg'])
    expect(names('24000000', input)).toEqual([])
    expect(names('2000000', input)).toHaveLength(4)
    expect(names('Not available', input)).toContain('notes.txt')
  })

  it('uses NOT before AND before OR and allows recursive parentheses', () => {
    expect(names('summer OR winter AND ext:png', input)).toEqual(['summer holiday.jpg', 'summer portrait.jpg', 'winter holiday.png'])
    expect(names('(summer OR winter) AND ext:png', input)).toEqual(['winter holiday.png'])
    expect(names('NOT (summer OR (winter AND ext:png))', input)).toEqual(['notes.txt'])
    expect(names('summer NOT camera:sony', input)).toEqual(['summer portrait.jpg'])
    expect(names('NOT NOT holiday', input)).toEqual(['summer holiday.jpg', 'winter holiday.png'])
    expect(names('type:image (aspect:landscape OR aspect:square) -name:winter', input)).toEqual(['summer holiday.jpg'])
    expect(names('NOT(type:document)', input)).toHaveLength(3)
  })

  it('keeps lowercase boolean words searchable and quotes uppercase operators', () => {
    const input = records([file('rock and roll.jpg'), file('AND.jpg'), file('NOT.jpg')])
    expect(names('and', input)).toEqual(['rock and roll.jpg', 'AND.jpg'])
    expect(names('"AND"', input)).toEqual(['rock and roll.jpg', 'AND.jpg'])
    expect(names('name="NOT.jpg"', input)).toEqual(['NOT.jpg'])
  })

  it('supports quoted phrases, both quote styles, escaped quotes, and literal punctuation', () => {
    const input = records([
      file('She said "hi".jpg', { metadata: { camera: 'A\\B' } }),
      file("O'Brien.jpg"),
      file('literal.*.jpg'),
      file('café.jpg'),
    ])
    expect(names('name:"She said \\"hi\\".jpg"', input)).toEqual(['She said "hi".jpg'])
    expect(names("name:'O\\'Brien.jpg'", input)).toEqual(["O'Brien.jpg"])
    expect(names('camera="A\\\\B"', input)).toEqual(['She said "hi".jpg'])
    expect(names('name:".*"', input)).toEqual(['literal.*.jpg'])
    expect(names('cafe\u0301', input)).toEqual(['café.jpg'])
    expect(names('name=cafe\u0301.jpg', input)).toEqual(['café.jpg'])
  })

  it('distinguishes text contains from exact matching and includes extensions in names', () => {
    expect(names('name:holiday', input)).toEqual(['summer holiday.jpg', 'winter holiday.png'])
    expect(names('name=holiday', input)).toEqual([])
    expect(names('name="SUMMER HOLIDAY.JPG"', input)).toEqual(['summer holiday.jpg'])
    expect(names('path="photos/summer holiday.jpg"', input)).toEqual(['summer holiday.jpg'])
    expect(names('from:photos to:renamed camera:"Sony A7"', input)).toEqual(['summer holiday.jpg'])
    expect(names('ext:.JPG', input)).toEqual(['summer holiday.jpg', 'summer portrait.jpg'])
    expect(names('ext:j', input)).toEqual([])
    expect(names('status:Ready', input)).toHaveLength(4)
    expect(names('status:Read', input)).toEqual([])
    expect(names('dimensions=6000x4000 index=1', input)).toEqual(['summer holiday.jpg'])
  })
})

describe('numeric and metadata filters', () => {
  it('compares exact bytes with decimal and binary units, including spaces', () => {
    const input = records([file('below.jpg', { size: 23_999_999 }), file('exact.jpg', { size: 24_000_000 }), file('above.jpg', { size: 24_000_001 })])
    expect(names('size < 24 MB', input)).toEqual(['below.jpg'])
    expect(names('filesize<=24MB', input)).toEqual(['below.jpg', 'exact.jpg'])
    expect(names('size=24MB', input)).toEqual(['exact.jpg'])
    expect(names('size!=24MB', input)).toEqual(['below.jpg', 'above.jpg'])
    expect(names('size>24MB', input)).toEqual(['above.jpg'])
    expect(names('size>=24000kB', input)).toEqual(['exact.jpg', 'above.jpg'])
    expect(names('size:>24MB', input)).toEqual(['above.jpg'])
    expect(names('size:"24 MB"', input)).toEqual(['exact.jpg'])
    const binary = records([file('binary.jpg', { size: 1024 ** 2 }), file('decimal.jpg', { size: 1_000_000 })])
    expect(names('size=1 MiB', binary)).toEqual(['binary.jpg'])
    expect(names('size=1MB', binary)).toEqual(['decimal.jpg'])
    expect(names('size=1048576B', binary)).toEqual(['binary.jpg'])
    expect(names('size<.001GB', binary)).toEqual([])
    expect(names('size<1TB size<1TiB size<1GiB', binary)).toHaveLength(2)
  })

  it('compares dimensions and aspect ratios and resolves shape names', () => {
    const input = records([
      file('wide.jpg', { metadata: { width: 1920, height: 1080 } }),
      file('landscape.jpg', { metadata: { width: 6000, height: 4000 } }),
      file('tall.jpg', { metadata: { width: 4000, height: 6000 } }),
      file('square.jpg', { metadata: { width: 1000, height: 1000 } }),
      file('unknown.jpg'),
    ])
    expect(names('width>=1900 height<1100', input)).toEqual(['wide.jpg'])
    expect(names('megapixels>20', input)).toEqual(['landscape.jpg', 'tall.jpg'])
    expect(names('aspect:16:9', input)).toEqual(['wide.jpg'])
    expect(names('aspect=3x2', input)).toEqual(['landscape.jpg'])
    expect(names('aspect:1.5', input)).toEqual(['landscape.jpg'])
    expect(names('aspect>=16:9', input)).toEqual(['wide.jpg'])
    expect(names('aspect>1', input)).toEqual(['wide.jpg', 'landscape.jpg'])
    expect(names('aspect:portrait', input)).toEqual(['tall.jpg'])
    expect(names('orientation:square', input)).toEqual(['square.jpg'])
    expect(names('aspect!=square', input)).toEqual(['wide.jpg', 'landscape.jpg', 'tall.jpg'])
  })

  it('distinguishes missing metadata from unequal values and zero', () => {
    const input = records([
      file('present.jpg', { metadata: { camera: 'Sony', width: 100, height: 100, iso: 0 } }),
      file('missing.jpg', { size: NaN, lastModified: NaN }),
    ])
    expect(names('camera!=Canon', input)).toEqual(['present.jpg'])
    expect(names('NOT camera:Canon', input)).toHaveLength(2)
    expect(names('width!=200', input)).toEqual(['present.jpg'])
    expect(names('width=0', input)).toEqual([])
    expect(names('size!=0', input)).toEqual(['present.jpg'])
    expect(names('date!=2024', input)).toEqual(['present.jpg'])
    expect(names('aspect!=2', input)).toEqual(['present.jpg'])
    expect(names('has:camera has:aspect has:metadata.iso', input)).toEqual(['present.jpg'])
    expect(names('-has:camera', input)).toEqual(['missing.jpg'])
    expect(names('has:date', input)).toEqual(['present.jpg'])
    expect(names('metadata.iso=0', input)).toEqual(['present.jpg'])
  })

  it('requires valid image dimensions for an aspect ratio', () => {
    const input = records([
      file('fractional.jpg', { metadata: { width: 1.5, height: 1 } }),
      file('unsafe.jpg', { metadata: { width: Number.MAX_SAFE_INTEGER + 1, height: 1 } }),
      file('zero.jpg', { metadata: { width: 100, height: 0 } }),
      file('valid.jpg', { metadata: { width: 3, height: 2 } }),
    ])
    expect(names('aspect>1', input)).toEqual(['valid.jpg'])
    expect(names('has:aspect', input)).toEqual(['valid.jpg'])
  })

  it('looks up extra metadata keys without case sensitivity and supports numeric comparisons', () => {
    const input = records([
      file('one.jpg', { metadata: { lensModel: 'Summilux 35mm', iso: '200', empty: '', invalid: NaN } }),
      file('two.jpg', { metadata: { lensModel: 'Summicron 50mm', iso: 400 } }),
      file('three.jpg', { metadata: { iso: 'unknown' } }),
    ])
    expect(names('metadata.LENSMODEL:summilux', input)).toEqual(['one.jpg'])
    expect(names('metadata.lensModel="Summilux 35mm"', input)).toEqual(['one.jpg'])
    expect(names('metadata.iso>=200 metadata.iso<400', input)).toEqual(['one.jpg'])
    expect(names('metadata.iso!=400', input)).toEqual(['one.jpg', 'three.jpg'])
    expect(names('metadata.lensModel!=summicron', input)).toEqual(['one.jpg', 'two.jpg'])
    expect(names('has:metadata.missing OR has:metadata.empty OR has:metadata.invalid', input)).toEqual([])
    expect(names('metadata.missing!=anything', input)).toEqual([])
  })
})

describe('calendar date filters', () => {
  const input = records([
    file('before.jpg', { lastModified: Date.UTC(2023, 11, 31, 23, 59, 59, 999) }),
    file('start.jpg', { lastModified: Date.UTC(2024, 0, 1) }),
    file('leap.jpg', { lastModified: Date.UTC(2024, 1, 29, 23, 59, 59, 999) }),
    file('end.jpg', { lastModified: Date.UTC(2024, 11, 31, 23, 59, 59, 999) }),
    file('after.jpg', { lastModified: Date.UTC(2025, 0, 1) }),
    file('later.jpg', { lastModified: Date.UTC(2026, 0, 1) }),
  ])

  it('treats year comparisons as complete UTC calendar periods', () => {
    expect(names('date:2024', input)).toEqual(['start.jpg', 'leap.jpg', 'end.jpg'])
    expect(names('modified=2024', input)).toEqual(['start.jpg', 'leap.jpg', 'end.jpg'])
    expect(names('date>2024 date<2026', input)).toEqual(['after.jpg'])
    expect(names('date>=2024 date<=2024', input)).toEqual(['start.jpg', 'leap.jpg', 'end.jpg'])
    expect(names('date<2024', input)).toEqual(['before.jpg'])
    expect(names('date<=2024', input)).toEqual(['before.jpg', 'start.jpg', 'leap.jpg', 'end.jpg'])
    expect(names('date!=2024', input)).toEqual(['before.jpg', 'after.jpg', 'later.jpg'])
  })

  it('supports leap days and month boundaries without local timezone dependence', () => {
    expect(names('date:2024-02', input)).toEqual(['leap.jpg'])
    expect(names('date=2024-02-29', input)).toEqual(['leap.jpg'])
    expect(names('date>2024-02', input)).toEqual(['end.jpg', 'after.jpg', 'later.jpg'])
    expect(names('date>2024-02-29', input)).toEqual(['end.jpg', 'after.jpg', 'later.jpg'])
    const taken = records([
      file('offset.jpg', { metadata: { taken: '2025-01-01T00:30:00+02:00' } }),
      file('numeric.jpg', { metadata: { taken: Date.UTC(2025, 0, 1) } }),
      file('missing.jpg'),
    ])
    expect(names('taken:2024-12-31', taken)).toEqual(['offset.jpg'])
    expect(names('taken>=2025', taken)).toEqual(['numeric.jpg'])
  })

  it.each(['2025-02-29', '2024-02-30', '2024-00', '2024-13', '2024-01-00', '2024-04-31', '2024-1', '24', '0000', '2024-01-01T00:00:00Z'])('rejects invalid or unsupported calendar date %s', value => {
    const query = compileFileSearch(`date:"${value}"`)
    expect(query.error?.message).toMatch(/date/)
    expect(input.some(query.matches)).toBe(false)
  })
})

describe('file type categories', () => {
  const input = records([
    file('photo.JPG', { type: '' }),
    file('raw.NEF', { type: 'application/octet-stream' }),
    file('movie.mp4', { type: '' }),
    file('sound.mp3', { type: '' }),
    file('report.pdf', { type: '' }),
    file('letter.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    file('ebook.epub', { type: '' }),
    file('bundle.zip', { type: '' }),
    file('unusual.jpg', { type: 'text/plain' }),
    file('unknown.bin', { type: '' }),
  ])

  it('recognizes MIME categories and common extension fallbacks', () => {
    expect(names('type:images', input)).toEqual(['photo.JPG', 'raw.NEF'])
    expect(names('type=image/jpeg', input)).toEqual(['photo.JPG'])
    expect(names('type:video', input)).toEqual(['movie.mp4'])
    expect(names('type:audio', input)).toEqual(['sound.mp3'])
    expect(names('type:documents', input)).toEqual(['report.pdf', 'letter.docx', 'ebook.epub', 'unusual.jpg'])
    expect(names('type:archives', input)).toEqual(['bundle.zip'])
    expect(names('has:type -type:image', input)).not.toContain('unknown.bin')
    expect(names('type!=image', input)).not.toContain('unknown.bin')
    expect(names('NOT type:image', input)).toContain('unknown.bin')
  })

  it('does not interpret inherited object keys as type fallbacks', () => {
    const input = records(['constructor', 'toString', '__proto__'].map(extension => file(`file.${extension}`, { type: '' })))
    expect(names('has:type', input)).toEqual([])
    expect(names('type:image', input)).toEqual([])
    expect(names('NOT type:image', input)).toHaveLength(3)
  })
})

describe('invalid search expressions', () => {
  it.each([
    'name:', 'size>', 'size>>2', 'foo:bar', 'has:foo', 'metadata.:value', 'size:1GiBB',
    'size:-1MB', 'width:many', 'aspect:16:0', 'aspect:0', 'type:photos', 'orientation:wide',
    'camera>Sony', 'has=name', 'OR photo', 'photo AND', '(photo', 'photo)', '()', '"open',
    'NOT', '-', '!photo', 'size<24MB OR', 'size==2', 'has:', '"name":photo', '__proto__:value', 'constructor:value',
  ])('returns a useful error and matches no records for %s', query => {
    const compiled = compileFileSearch(query)
    expect(compiled.error?.message).toBeTruthy()
    expect(compiled.error?.position).toBeGreaterThanOrEqual(0)
    expect(compiled.error?.position).toBeLessThanOrEqual(query.length)
    expect(records([file('photo.jpg')]).filter(compiled.matches)).toEqual([])
  })

  it('points to the bad field or date literal and gives guidance', () => {
    expect(compileFileSearch('holiday mystery:yes').error).toMatchObject({ position: 8, message: expect.stringContaining('Unknown field') })
    expect(compileFileSearch('date:2025-02-29').error).toMatchObject({ position: 5, message: expect.stringContaining('valid calendar date') })
    expect(compileFileSearch('has:mystery').error).toMatchObject({ position: 4, message: expect.stringContaining('Unknown field') })
  })

  it('limits pathological nesting and query length without throwing', () => {
    expect(compileFileSearch(`${'('.repeat(100)}photo${')'.repeat(100)}`).error?.message).toMatch(/nested/)
    expect(compileFileSearch(`${'NOT '.repeat(100)}photo`).error?.message).toMatch(/nested/)
    expect(compileFileSearch('a'.repeat(16_385)).error?.message).toMatch(/16,384/)
    expect(compileFileSearch(Array(1000).fill('photo').join(' OR ')).error).toBeUndefined()
  })
})

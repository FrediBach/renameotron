import { describe, expect, it } from 'vitest'
import { buildRenamePlan, formatBytes, getFileTokenDetails, type FileEntry } from './rename'
import { TEMPLATES } from './templates'

function file(name: string, overrides: Partial<FileEntry> = {}): FileEntry {
  return { id: name, name, path: name, size: 1280, type: 'image/jpeg', lastModified: Date.UTC(2025, 3, 12, 14, 5, 9), metadata: {}, ...overrides }
}

describe('file metadata details', () => {
  it('uses exactly the same token values as the rename preview, including dates and stable UUIDs', () => {
    const photo = file('photo.jpg', { metadata: { taken: '2026-10-12T10:24:35+02:00', camera: 'Camera $&', width: 6240, height: 4160 } })
    const details = getFileTokenDetails(photo, 1)
    for (const token of details) {
      expect(token.error).toBeUndefined()
      const plan = buildRenamePlan([photo], '^.+$', `prefix-${token.example}`)
      expect(plan.rows[0].targetPath).toBe(`prefix-${token.value}`)
    }
    expect(details.find(token => token.key === 'taken')).toMatchObject({ value: '2026-10-12', displayValue: '2026-10-12 08:24:35 UTC' })
    expect(details.find(token => token.key === 'modified')).toMatchObject({ value: '2025-04-12', displayValue: '2025-04-12 14:05:09 UTC' })
    expect(getFileTokenDetails(photo, 7).find(token => token.key === 'index')?.value).toBe('007')
  })

  it('distinguishes empty extensions and zero-byte files from unavailable or invalid metadata', () => {
    const details = getFileTokenDetails(file('README', { size: 0, type: '', lastModified: NaN, metadata: { taken: 'invalid' } }))
    expect(details.find(token => token.key === 'ext')).toMatchObject({ value: '', displayValue: '' })
    expect(details.find(token => token.key === 'size')?.value).toBe('0')
    for (const key of ['type', 'modified', 'taken', 'camera', 'width', 'height', 'index']) {
      const token = details.find(token => token.key === key)
      expect(token?.value).toBeUndefined()
      expect(token?.error).toBeTruthy()
    }
  })
})

describe('buildRenamePlan', () => {
  it('matches filenames, expands captures and metadata, and preserves parents for plain names', () => {
    const result = buildRenamePlan([file('IMG_1234.JPG', { path: 'raw/IMG_1234.JPG' })], '^IMG_(\\d+)\\.(jpg|png)$', '$1-{index:3}-{name}.{ext}', 'i')
    expect(result.rows[0]).toMatchObject({ status: 'ready', targetPath: 'raw/1234-001-IMG_1234.JPG' })
    expect(result.matchedCount).toBe(1)
  })

  it('treats replacement subdirectories as root relative', () => {
    const result = buildRenamePlan([file('notes.md', { path: 'drafts/notes.md' })], '^.+$', 'archive/{modified:YYYY-MM}/$&', '')
    expect(result.rows[0].targetPath).toBe('archive/2025-04/notes.md')
  })

  it('indexes only selected matching files and resets global regex state per file', () => {
    const result = buildRenamePlan([file('a.jpg'), file('notes.md'), file('b.jpg'), file('c.jpg')], '^.*\\.jpg$', '{index:3}.{ext}', 'g', new Set(['a.jpg', 'notes.md', 'c.jpg']))
    expect(result.rows.map((row) => [row.status, row.targetPath])).toEqual([
      ['ready', '001.jpg'], ['unmatched', 'notes.md'], ['unmatched', 'b.jpg'], ['ready', '002.jpg'],
    ])
    expect(result.matchedCount).toBe(2)
  })

  it('keeps normal JavaScript replacement behavior, including named groups and dollars', () => {
    const result = buildRenamePlan([file('a-b.txt')], '^(?<first>a)-(b)(\\.txt)$', '$<first>-$2-$$$3', '')
    expect(result.rows[0].targetPath).toBe('a-b-$.txt')
  })

  it('does not interpret replacement syntax embedded in metadata or captured filenames', () => {
    const result = buildRenamePlan([file('{camera}.jpg', { metadata: { camera: '$&-{index}' } })], '^(.+)\\.jpg$', '{camera}-$1.jpg', '')
    expect(result.rows[0].targetPath).toBe('$&-{index}-{camera}.jpg')
  })

  it('reports invalid regular expressions and flags without throwing', () => {
    expect(buildRenamePlan([file('a.jpg')], '[', 'new.jpg', 'i').error).toBeTruthy()
    expect(buildRenamePlan([file('a.jpg')], '.', 'new.jpg', 'ii').error).toBeTruthy()
  })

  it('leaves an empty pattern inactive and distinguishes unchanged matches', () => {
    expect(buildRenamePlan([file('a.jpg')], '', 'new.jpg', '').matchedCount).toBe(0)
    expect(buildRenamePlan([file('a.jpg')], '^.+$', '$&', '').rows[0].status).toBe('unchanged')
  })

  it.each(['../escape.jpg', '/absolute.jpg', 'C:/file.jpg', 'a//b.jpg', 'a/./b.jpg', 'a/../b.jpg', 'folder/', 'bad\\name.jpg', 'a?.jpg', 'CON.txt', 'a. ', 'a\u0000.jpg', ''])('blocks unsafe or empty destination %j', (replacement) => {
    const result = buildRenamePlan([file('photo.jpg')], '^.+$', replacement, '')
    expect(result.rows[0].status).toBe('error')
    expect(result.readyCount).toBe(0)
  })

  it('blocks destinations occupied by unmatched or unselected files', () => {
    const result = buildRenamePlan([file('photo.jpg'), file('existing.jpg')], '^photo\\.jpg$', 'existing.jpg', '', new Set(['photo.jpg']))
    expect(result.rows[0]).toMatchObject({ status: 'error', error: 'A file already exists at this destination.' })
  })

  it('blocks all duplicate destinations using case-insensitive Unicode-normalized paths', () => {
    const result = buildRenamePlan([file('A.jpg'), file('a.png')], '^(.+)\\.[^.]+$', '$1.webp', '')
    expect(result.errorCount).toBe(2)
    const unicode = buildRenamePlan([file('one.txt'), file('café.txt')], '^one.txt$', 'cafe\u0301.txt', '')
    expect(unicode.rows[0].status).toBe('error')
  })

  it('blocks case-only renames and dependencies on other renamed files', () => {
    expect(buildRenamePlan([file('a.jpg')], '^.+$', 'A.jpg', '').rows[0].status).toBe('error')
    const dependency = buildRenamePlan([file('a.txt', { metadata: { camera: 'b' } }), file('b.txt', { metadata: { camera: 'c' } })], '^.+$', '{camera}.txt', '')
    expect(dependency.rows.map((row) => row.status)).toEqual(['error', 'ready'])
  })

  it('blocks both existing and planned file/folder conflicts', () => {
    const existingFolder = buildRenamePlan([file('a.txt'), file('b.txt', { path: 'archive/b.txt' })], '^a.txt$', 'archive', '')
    expect(existingFolder.rows[0].status).toBe('error')
    const existingFile = buildRenamePlan([file('a.txt'), file('folder')], '^a.txt$', 'folder/a.txt', '')
    expect(existingFile.rows[0].status).toBe('error')
    const planned = buildRenamePlan([file('a.txt', { metadata: { camera: 'archive' } }), file('b.txt', { metadata: { camera: 'archive/b.txt' } })], '^.+$', '{camera}', '')
    expect(planned.errorCount).toBe(2)
  })

  it('flags folder casing and Unicode conflicts before execution', () => {
    const existingFolder = buildRenamePlan([file('a.txt'), file('b.txt', { path: 'Archive/b.txt' })], '^a.txt$', 'archive/a.txt', '')
    expect(existingFolder.rows[0].status).toBe('error')
    const existingUnicode = buildRenamePlan([file('a.txt'), file('b.txt', { path: 'café/b.txt' })], '^a.txt$', 'cafe\u0301/a.txt', '')
    expect(existingUnicode.rows[0].status).toBe('error')
    const planned = buildRenamePlan([file('a.txt', { metadata: { camera: 'Archive' } }), file('b.txt', { metadata: { camera: 'archive' } })], '^.+$', '{camera}/{name}.txt', '')
    expect(planned.errorCount).toBe(2)
    const exact = buildRenamePlan([file('a.txt'), file('b.txt', { path: 'Archive/b.txt' })], '^a.txt$', 'Archive/a.txt', '')
    expect(exact.rows[0].status).toBe('ready')
  })

  it('rejects destination names and paths exceeding executor limits', () => {
    expect(buildRenamePlan([file('a.txt')], '^.+$', 'a'.repeat(256), '').rows[0].status).toBe('error')
    expect(buildRenamePlan([file('a.txt')], '^.+$', `${'a/'.repeat(2048)}a`, '').rows[0].status).toBe('error')
    expect(buildRenamePlan([file('a.txt')], '^.+$', 'a'.repeat(255), '').rows[0].status).toBe('ready')
  })

  it('uses UTC metadata dates and reports missing metadata', () => {
    const good = buildRenamePlan([file('photo.jpg', { metadata: { taken: '2025-02-03T04:05:06Z', camera: 'X100VI', width: 6000, height: 4000 } })], '^.+$', '{taken:YYYY-MM-DD}_{taken:HH-mm-ss}-{camera}-{width}x{height}.{ext}', '')
    expect(good.rows[0].targetPath).toBe('2025-02-03_04-05-06-X100VI-6000x4000.jpg')
    for (const token of ['taken', 'camera', 'width', 'height']) {
      expect(buildRenamePlan([file('photo.jpg')], '^.+$', `{${token}}.jpg`, '').rows[0].error).toContain('Missing')
    }
  })

  it('reports unsupported tokens and formats', () => {
    for (const replacement of ['{unknown}.jpg', '{index:100}.jpg', '{index:no}.jpg', '{name:3}.jpg', '{modified:yy}.jpg']) {
      expect(buildRenamePlan([file('a.jpg')], '^.+$', replacement, '').rows[0].status).toBe('error')
    }
  })

  it('keeps a UUID stable across preview changes and unique between files', () => {
    const files = [file('a.jpg'), file('b.jpg')]
    const first = buildRenamePlan(files, '^.+$', '{uuid}.{ext}', '')
    const second = buildRenamePlan(files, '^.+$', 'archive/{uuid}.{ext}', '')
    expect(first.rows[0].targetPath).toMatch(/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}\.jpg$/)
    expect(second.rows[0].targetPath).toBe(`archive/${first.rows[0].targetPath}`)
    expect(first.rows[0].targetPath).not.toBe(first.rows[1].targetPath)
  })

  it('treats dotfiles as extensionless', () => {
    expect(buildRenamePlan([file('.env')], '^.+$', '{name}-backup', '').rows[0].targetPath).toBe('.env-backup')
  })
})

describe('templates and helpers', () => {
  it('ships valid patterns and unique template IDs', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(20)
    expect(new Set(TEMPLATES.map((template) => template.id)).size).toBe(TEMPLATES.length)
    for (const template of TEMPLATES) expect(() => new RegExp(template.pattern, template.flags)).not.toThrow()
  })

  it('formats file sizes consistently', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1280)).toBe('1.3 KB')
    expect(formatBytes(2_500_000)).toBe('2.5 MB')
  })
})

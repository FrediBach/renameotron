import { describe, expect, it } from 'vitest'
import { buildRenamePlan, type FileEntry } from './rename'
import { TEMPLATES } from './templates'
import { getTemplateExample } from './template-examples'

function file(name: string, overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    id: name,
    name,
    path: name,
    size: 2_400_000,
    type: 'image/jpeg',
    lastModified: Date.UTC(2025, 3, 12, 14, 5, 9),
    metadata: { taken: '2025-02-03T06:05:06+02:00', camera: '  Fujifilm X100 VI  ', width: 6240, height: 4160 },
    ...overrides,
  }
}

function preview(id: string, files: FileEntry[], selectedIds?: Set<string>) {
  const template = TEMPLATES.find(template => template.id === id)
  if (!template) throw new Error(`Missing template: ${id}`)
  return buildRenamePlan(files, template.pattern, template.replacement, template.flags, selectedIds)
}

describe('template recipes', () => {
  it.each(TEMPLATES)('has a working browser example for $name', template => {
    const example = getTemplateExample(template)
    expect(example.to).not.toMatch(/^(No rename|Example unavailable)/)
    expect(example.to).not.toBe(example.from)
  })

  it('retains the existing recipes when extending the catalog', () => {
    expect(TEMPLATES.map(template => template.id)).toEqual(expect.arrayContaining([
      'photo-sequence', 'spaces-to-dashes', 'spaces-to-underscores', 'underscores-to-dashes',
      'add-prefix', 'add-suffix', 'remove-copy', 'remove-number-prefix', 'number-files', 'unique-id',
      'photo-capture', 'photo-camera', 'photo-dimensions', 'photo-albums',
      'document-date', 'document-version', 'document-invoices', 'document-extension',
      'organize-extension', 'organize-year', 'organize-month', 'organize-delivery',
    ]))
  })

  it.each(TEMPLATES)('produces a usable rename with $name', template => {
    const names = [
      'IMG_1234.JPG',
      '  Café  Summer__Trip (1).JPG',
      'Résumé__Final  Draft.PDF',
      '001 - Meeting notes.txt',
      'Annual Report copy 2.pdf',
      'notes.markdown',
      'backup.final.txt',
      '2025-04-12 Meeting notes.pdf',
      'Meeting Notes_v01.pdf',
      'Meeting notes-final.pdf',
      'Early_Morning.MP3',
      'Salt & Pepper @ Home.txt',
      '[final] Meeting notes.pdf',
      'Copy of Meeting notes.pdf',
      'A very long filename with enough detail to exceed the suggested title length for a shared project document.pdf',
      'README',
    ]
    // Each preview is independent: recipes that replace the whole name can
    // legitimately collide when unrelated examples are passed as one batch.
    const plans = names.map(name => buildRenamePlan([file(name)], template.pattern, template.replacement, template.flags))
    expect(plans[0].error).toBeUndefined()
    const errors = plans.flatMap(plan => plan.rows.flatMap(row => row.error ? [row.error] : []))
    // Casing/ASCII cleanup can be blocked by the engine when it is the only
    // change. Every other error indicates an invalid recipe for these inputs.
    const unexpectedErrors = plans.flatMap(plan => plan.rows.flatMap(row =>
      row.error && row.error !== 'Case-only or equivalent Unicode renames are not supported in this preview.'
        ? [`${row.file.name}: ${row.error}`]
        : []))
    expect(unexpectedErrors).toEqual([])
    expect(plans.some(plan => plan.readyCount === 1), `${template.id}: ${errors.join('; ')}`).toBe(true)
  })

  it.each([
    ['spaces-to-dashes', '  Meeting   Notes .TXT', 'Meeting-Notes.TXT'],
    ['spaces-to-underscores', '  Meeting   Notes .TXT', 'Meeting_Notes.TXT'],
    ['clean-slug', 'Café Summer__Trip.txt', 'cafe-summer-trip.txt'],
    ['ascii-filenames', 'Crème Brûlée.txt', 'Creme Brulee.txt'],
    ['uppercase-underscores', 'Hello World.txt', 'HELLO_WORLD.txt'],
    ['title-words', 'my_project-notes.md', 'My Project Notes.md'],
    ['dots-to-spaces', 'my.project.notes.md', 'my project notes.md'],
    ['shorten-name', `${'A'.repeat(80)}.txt`, `${'a'.repeat(60)}-001.txt`],
    ['number-only', 'Meeting notes.PDF', '0001.PDF'],
    ['number-tracks', 'Early_Morning.MP3', '01 - Early Morning.mp3'],
    ['photo-capture', 'Photo.JPG', '2025-02-03_04-05-06-001.jpg'],
    ['photo-camera', 'Photo.JPG', 'fujifilm-x100-vi-001.jpg'],
    ['photo-dimensions', 'Summer Trip.JPG', 'summer-trip-6240x4160.jpg'],
    ['photo-megapixels', 'Summer Trip.JPG', 'summer-trip-26MP.jpg'],
    ['photo-width', 'Summer Trip.JPG', 'summer-trip-6.2kpx-wide.jpg'],
    ['photo-aspect', 'Summer Trip.JPG', 'summer-trip-3x2.jpg'],
    ['document-date', 'Annual Report.PDF', '2025-04-12-annual-report.pdf'],
    ['document-version', 'Annual Report.PDF', 'annual-report-v01.pdf'],
    ['document-invoices', 'Annual Report.PDF', 'invoice-2025-04-001.pdf'],
    ['date-timestamp', 'meeting.txt', '2025-04-12_14-05-09-meeting.txt'],
    ['details-readable-size', 'meeting.txt', 'meeting-2.4MB.txt'],
    ['details-compact-size', 'meeting.txt', 'meeting-2.4M-bytes.txt'],
    ['details-type', 'photo.jpg', 'photo-jpeg.jpg'],
    ['organize-extension', 'README', 'no-extension/README'],
    ['organize-name-folder', 'README', 'readme-files/README'],
  ])('applies %s to %s', (id, name, expected) => {
    expect(preview(id, [file(name)]).rows[0]).toMatchObject({ status: 'ready', targetPath: expected })
  })

  it.each([
    ['photo-capture', 'undated-001.jpg'],
    ['photo-camera', 'unknown-camera-001.jpg'],
    ['photo-albums', 'undated/holiday.jpg'],
    ['photo-camera-date', 'unknown-camera-undated-001.jpg'],
    ['photo-date-name', 'undated-holiday.jpg'],
    ['organize-camera', 'unknown-camera/Holiday.JPG'],
    ['organize-capture-day', 'undated/Holiday.JPG'],
    ['details-type', 'Holiday-unknown.JPG'],
    ['organize-type', 'unknown/Holiday.JPG'],
  ])('uses a useful missing-metadata fallback for %s', (id, expected) => {
    expect(preview(id, [file('Holiday.JPG', { type: '', metadata: {} })]).rows[0])
      .toMatchObject({ status: 'ready', targetPath: expected })
  })

  it('recovers invalid capture dates and sanitizes camera labels', () => {
    expect(preview('photo-capture', [file('photo.jpg', { metadata: { taken: 'invalid' } })]).rows[0])
      .toMatchObject({ status: 'ready', targetPath: 'undated-001.jpg' })
    expect(preview('photo-camera', [file('photo.jpg', { metadata: { camera: 'Sony / Alpha: A7?' } })]).rows[0])
      .toMatchObject({ status: 'ready', targetPath: 'sony-alpha-a7-001.jpg' })
    expect(preview('details-type', [file('Artwork.svg', { type: 'image/svg+xml' })]).rows[0])
      .toMatchObject({ status: 'ready', targetPath: 'Artwork-svg.svg' })
  })

  it('keeps parent folders for names and creates root-relative organization folders', () => {
    const source = file('Meeting notes.txt', { path: 'drafts/Meeting notes.txt' })
    expect(preview('add-prefix', [source]).rows[0])
      .toMatchObject({ status: 'ready', targetPath: 'drafts/project-Meeting notes.txt' })
    expect(preview('organize-month', [source]).rows[0])
      .toMatchObject({ status: 'ready', targetPath: '2025/04/Meeting notes.txt' })
  })

  it('routes landscape originals to nested folders and everything else to the fallback', () => {
    const plan = preview('organize-landscape-route', [
      file('mountains.jpg', { path: 'trip/mountains.jpg' }),
      file('portrait.jpg', { metadata: { width: 2000, height: 3000 } }),
      file('square.jpg', { metadata: { width: 2000, height: 2000 } }),
      file('unknown.jpg', { metadata: {} }),
      file('README', { type: 'text/plain', metadata: {} }),
      file('wide.mp4', { type: 'video/mp4', metadata: { width: 1920, height: 1080 } }),
    ])
    expect(plan.errorCount).toBe(0)
    expect(plan.rows.map(row => row.targetPath)).toEqual([
      'photos/landscape/originals/mountains.jpg',
      'photos/other/portrait.jpg',
      'photos/other/square.jpg',
      'photos/other/unknown.jpg',
      'photos/other/README',
      'photos/other/wide.mp4',
    ])
  })

  it('uses elseif orientation routes and a fallback for unavailable dimensions', () => {
    const plan = preview('organize-orientation-routes', [
      file('landscape.jpg'),
      file('portrait.jpg', { metadata: { width: 2000, height: 3000 } }),
      file('square.jpg', { metadata: { width: 2000, height: 2000 } }),
      file('unknown.jpg', { metadata: {} }),
    ])
    expect(plan.errorCount).toBe(0)
    expect(plan.rows.map(row => row.targetPath)).toEqual([
      'photos/landscape/landscape.jpg', 'photos/portrait/portrait.jpg',
      'photos/square/square.jpg', 'photos/unknown/unknown.jpg',
    ])
  })

  it('only formats a capture date when the metadata is available', () => {
    const plan = preview('organize-capture-fallback', [
      file('dated.jpg'),
      file('undated.jpg', { metadata: {} }),
      file('invalid.jpg', { metadata: { taken: 'invalid' } }),
    ])
    expect(plan.errorCount).toBe(0)
    expect(plan.rows.map(row => row.targetPath)).toEqual([
      'photos/2025/02/dated.jpg', 'photos/undated/undated.jpg', 'photos/undated/invalid.jpg',
    ])
  })

  it('requires both image type and size above the threshold for the large-image route', () => {
    const plan = preview('organize-large-images', [
      file('large.jpg', { size: 10_000_001 }),
      file('at-limit.jpg', { size: 10_000_000 }),
      file('small.jpg', { size: 1_000_000 }),
      file('large.pdf', { type: 'application/pdf', size: 20_000_000 }),
    ])
    expect(plan.errorCount).toBe(0)
    expect(plan.rows.map(row => row.targetPath)).toEqual([
      'assets/large-images/large.jpg', 'assets/other/at-limit.jpg',
      'assets/other/small.jpg', 'assets/other/large.pdf',
    ])
  })

  it('routes mixed file types, including extension fallbacks and unknown files', () => {
    const plan = preview('organize-file-kind', [
      file('photo.jpg', { type: '' }),
      file('report.pdf', { type: 'application/pdf', metadata: {} }),
      file('notes.txt', { type: '', metadata: {} }),
      file('package.zip', { type: 'application/zip', metadata: {} }),
      file('README', { type: '', metadata: {} }),
    ])
    expect(plan.errorCount).toBe(0)
    expect(plan.rows.map(row => row.targetPath)).toEqual([
      'photos/photo.jpg', 'documents/report.pdf', 'documents/notes.txt', 'other/package.zip', 'other/README',
    ])
  })

  it('numbers only matching, selected photos using a padded sequence', () => {
    const plan = preview('photo-sequence', [file('IMG_1234.JPG'), file('notes.pdf'), file('IMG_2345.JPG'), file('IMG_3456.JPG')], new Set(['IMG_1234.JPG', 'notes.pdf', 'IMG_3456.JPG']))
    expect(plan.error).toBeUndefined()
    expect(plan.rows.map(row => [row.status, row.targetPath])).toEqual([
      ['ready', 'studio-001.jpg'],
      ['unmatched', 'notes.pdf'],
      ['unmatched', 'IMG_2345.JPG'],
      ['ready', 'studio-002.jpg'],
    ])
  })

  it.each(['add-prefix', 'add-suffix', 'number-files', 'organize-extension', 'organize-year', 'organize-month', 'organize-delivery'])('handles extensionless files and dotfiles with %s', id => {
    for (const name of ['README', '.env']) {
      const plan = preview(id, [file(name)])
      expect(plan.rows[0].error).toBeUndefined()
      expect(plan.rows[0].status).toBe('ready')
      expect(plan.rows[0].targetPath).not.toMatch(/\.$/)
    }
  })

  it('requires real image measurements for dimension labels', () => {
    const plan = preview('photo-dimensions', [file('portrait.jpg', { metadata: {} })])
    expect(plan.rows[0].status).toBe('error')
    expect(plan.rows[0].error).toContain('Missing width metadata')
    expect(plan.readyCount).toBe(0)
  })

  it('retains UUIDs when the same template is previewed again', () => {
    const source = [file('notes.txt'), file('README')]
    const first = preview('unique-id', source)
    const again = preview('unique-id', source)
    expect(first.errorCount).toBe(0)
    expect(again.rows.map(row => row.targetPath)).toEqual(first.rows.map(row => row.targetPath))
    expect(first.rows[0].targetPath).toMatch(/^[a-f\d-]{36}\.txt$/)
    expect(first.rows[1].targetPath).toMatch(/^[a-f\d-]{36}$/)
    expect(first.rows[0].targetPath.slice(0, 36)).not.toBe(first.rows[1].targetPath)
  })
})

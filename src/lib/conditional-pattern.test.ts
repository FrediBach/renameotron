import { describe, expect, it } from 'vitest'
import { compileConditionalPattern } from './conditional-pattern'
import { buildRenamePlan, type FileEntry } from './rename'

function file(name: string, metadata: FileEntry['metadata'] = {}, overrides: Partial<FileEntry> = {}): FileEntry {
  return { id: name, name, path: `incoming/${name}`, size: 2_000_000, type: 'image/jpeg', lastModified: Date.UTC(2025, 5, 1), metadata, ...overrides }
}

describe('conditional replacement patterns', () => {
  it('routes landscapes into a subdirectory and all other files into the fallback', () => {
    const files = [
      file('wide.jpg', { width: 6000, height: 4000 }),
      file('tall.jpg', { width: 4000, height: 6000 }),
      file('square.jpg', { width: 1000, height: 1000 }),
      file('unknown.jpg'),
      file('notes.txt', {}, { type: 'text/plain' }),
    ]
    const plan = buildRenamePlan(files, '^.+$', '{if type:image orientation:landscape}photos/landscape/originals/{else}photos/other/{end}$&')
    expect(plan.rows.map(row => row.targetPath)).toEqual([
      'photos/landscape/originals/wide.jpg', 'photos/other/tall.jpg', 'photos/other/square.jpg', 'photos/other/unknown.jpg', 'photos/other/notes.txt',
    ])
    expect(plan.readyCount).toBe(5)
  })

  it('expands metadata only in the selected branch, including has guards and nested blocks', () => {
    const replacement = '{if has:taken}photos/{taken|date("YYYY/MM")}/{if orientation:landscape}wide/{else}other/{end}{else}undated/{end}$&'
    const plan = buildRenamePlan([
      file('dated.jpg', { taken: '2025-03-15T10:00:00Z', width: 4000, height: 2000 }),
      file('missing.jpg'),
      file('invalid.jpg', { taken: 'invalid' }),
    ], '^.+$', replacement)
    expect(plan.rows.map(row => row.targetPath)).toEqual(['photos/2025/03/wide/dated.jpg', 'undated/missing.jpg', 'undated/invalid.jpg'])
    expect(plan.errorCount).toBe(0)
  })

  it('uses the first matching elseif and permits an omitted else', () => {
    const compiled = compileConditionalPattern('{if size>10MB}large{elseif size>1MB}medium{elseif type:image}image{else}other{end}')
    expect(compiled.render(file('test.jpg'), 1)).toBe('medium')
    const optional = compileConditionalPattern('{if orientation:portrait}portrait-{end}$&')
    expect(optional.render(file('test.jpg'), 1)).toBe('$&')
    expect(optional.render(file('test.jpg', { width: 100, height: 200 }), 1)).toBe('portrait-$&')
    expect(compileConditionalPattern('{if has:camera}camera/{end}{if type:image}images/{end}$&').render(file('test.jpg'), 1)).toBe('images/$&')
  })

  it('preserves capture expansion, literal source text, and metadata output highlighting', () => {
    const source = file('IMG_12.JPG', { camera: '$&-{if type:image}' })
    const plan = buildRenamePlan([source], '^IMG_(?<number>\\d+)\\.(JPG)$', '{if has:camera}{camera}/$<number>-{index|pad(3)}.$2{else}$&{end}')
    expect(plan.rows[0].targetPath).toBe('$&-{if type:image}/12-001.JPG')
    // A colon in the literal camera value is still rejected by destination validation.
    expect(plan.rows[0].status).toBe('error')
    const good = buildRenamePlan([file('{else}.jpg', { camera: '$&-{end}' })], '^(.+)\\.jpg$', '{if has:camera}{camera}/{name}-$1-{index:3}.jpg{end}')
    expect(good.rows[0]).toMatchObject({ status: 'ready', targetPath: '$&-{end}/{else}-{else}-001.jpg' })
    expect(good.rows[0].targetHighlights?.filter(span => span.token === 'index').map(span => good.rows[0].targetPath.slice(span.start, span.end))).toEqual(['001'])
  })

  it('keeps directive-like text inside quoted conditions and modifier arguments literal', () => {
    const source = file('a.jpg', { camera: 'A {else} "$&"' })
    const replacement = '{if camera=\'A {else} "$&"\'}yes/{else}no/{end}{name|suffix("-{if nope}{end}")}.{ext}'
    expect(buildRenamePlan([source], '^.+$', replacement).rows[0]).toMatchObject({ status: 'ready', targetPath: 'yes/a-{if nope}{end}.jpg' })
    const escaped = String.raw`{if camera="A \"{end}\""}yes/{else}no/{end}$&`
    expect(buildRenamePlan([file('b.jpg', { camera: 'A "{end}"' })], '^.+$', escaped).rows[0].targetPath).toBe('yes/b.jpg')
    const trailingSpace = String.raw`{if camera=Sony\ }yes/{else}no/{end}$&`
    expect(buildRenamePlan([file('c.jpg', { camera: 'Sony ' })], '^.+$', trailingSpace).rows[0].targetPath).toBe('yes/c.jpg')
  })

  it('keeps selected-match indexing global across branches and preserves the parent for plain names', () => {
    const files = [file('a.jpg'), file('b.txt'), file('c.jpg'), file('d.jpg')]
    const valid = buildRenamePlan(files, '^.+\\.(?<extension>jpg)$', '{if index=1}first-{else}later-{end}{index:3}.$<extension>', '', new Set(['a.jpg', 'b.txt', 'd.jpg']))
    expect(valid.rows.map(row => row.targetPath)).toEqual(['incoming/first-001.jpg', 'incoming/b.txt', 'incoming/c.jpg', 'incoming/later-002.jpg'])
  })

  it('validates syntax in inactive branches, before files or matches are available', () => {
    for (const replacement of [
      '{if type:image}ok/{else}{unknown}/{end}$&',
      '{if type:image}ok/{else}{name|unknown}/{end}$&',
      '{if type:image}ok/{elseif width>wrong}bad/{end}$&',
      '{if type:image}ok/{else}{taken:invalid}/{end}$&',
      '{if type:image}{na{else}{unknown{end}me}.jpg',
      '{{if type:image}name{else}unknown{end}}.jpg',
    ]) {
      expect(() => compileConditionalPattern(replacement)).toThrow()
      expect(buildRenamePlan([], '^.+$', replacement).replacementError).toBeTruthy()
      expect(buildRenamePlan([file('a.jpg')], '^.+$', replacement).rows[0].status).toBe('error')
    }
  })

  it.each([
    '{if}x{end}', '{if }x{end}', '{if type:image}x', '{if type:image',
    '{else}x', '{elseif type:image}x', '{end}',
    '{if type:image}x{else}y{else}z{end}',
    '{if type:image}x{else}y{elseif size>1MB}z{end}',
    '{if type:image}x{else something}y{end}', '{if type:image}x{end something}',
    '{if to:photos}x{end}', '{if NOT has:status}x{end}', '{if landscape}x{end}',
    '{if camera="unclosed}x{end}',
  ])('rejects malformed conditional pattern %s', pattern => {
    expect(() => compileConditionalPattern(pattern)).toThrow()
  })

  it('bounds nesting but supports sixteen levels', () => {
    const pattern = (depth: number) => '{if type:image}'.repeat(depth) + 'ok' + '{end}'.repeat(depth)
    expect(compileConditionalPattern(pattern(16)).render(file('test.jpg'), 1)).toBe('ok')
    expect(() => compileConditionalPattern(pattern(17))).toThrow('16 nested')
  })

  it('checks final destinations across branches for unsafe paths, duplicate files, and folder conflicts', () => {
    const files = [file('a.jpg', { width: 3000, height: 2000 }), file('b.jpg')]
    const duplicate = buildRenamePlan(files, '^.+$', '{if orientation:landscape}same/file.jpg{else}same/file.jpg{end}')
    expect(duplicate.errorCount).toBe(2)
    expect(duplicate.rows.every(row => row.error?.includes('same destination'))).toBe(true)
    const unsafe = buildRenamePlan(files, '^.+$', '{if orientation:landscape}../$&{else}safe/$&{end}')
    expect(unsafe.rows.map(row => row.status)).toEqual(['error', 'ready'])
    const blocked = buildRenamePlan(files, '^.+$', '{if orientation:landscape}out/archive{else}out/archive/$&{end}')
    expect(blocked.errorCount).toBe(2)
  })
})

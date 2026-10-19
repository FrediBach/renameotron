import { beforeEach, describe, expect, it, vi } from 'vitest'
import exifr from 'exifr'
import { applyRenamePlan, scanDirectory } from './filesystem'
import type { RenameRow } from './rename'

vi.mock('exifr', () => ({ default: { parse: vi.fn() } }))

interface Controls {
  failWrite?: string
  failClose?: string
  failDelete?: string
  corruptCopy?: string
  onClose?: () => void
  nativeError?: string
}

class FakeFile {
  readonly kind = 'file'
  lastModified = 1_700_000_000_000
  move?: (directory: FakeDirectory, name: string) => Promise<void>

  constructor(public name: string, public parent: FakeDirectory, public content: string) {}
  get path(): string { return this.parent.path ? `${this.parent.path}/${this.name}` : this.name }
  async isSameEntry(other: unknown) { return other === this }
  async getFile() {
    this.parent.events.push(`read:${this.path}`)
    return new File([this.content], this.name, { type: 'text/plain', lastModified: this.lastModified })
  }
  async createWritable() {
    const path = this.path
    const { events, controls } = this.parent
    events.push(`open:${path}`)
    let staged = ''
    return {
      write: async (file: Blob) => {
        events.push(`write:${path}`)
        if (controls.failWrite === path) throw new Error('Disk full during write')
        staged = await file.text()
      },
      close: async () => {
        events.push(`close:${path}`)
        if (controls.failClose === path) throw new Error('Could not commit destination')
        this.content = controls.corruptCopy === path ? staged.slice(0, -1) : staged
        controls.onClose?.()
      },
      abort: async () => { events.push(`abort:${path}`) },
    }
  }
  enableNative() {
    this.move = async (directory, name) => {
      this.parent.events.push(`move:${this.path}`)
      if (this.parent.controls.nativeError) throw new Error(this.parent.controls.nativeError)
      this.parent.items.delete(this.name)
      directory.items.set(name, this)
      this.parent = directory
      this.name = name
    }
  }
}

class FakeDirectory {
  readonly kind = 'directory'
  readonly items = new Map<string, FakeFile | FakeDirectory>()
  constructor(
    public name: string,
    public events: string[],
    public controls: Controls,
    public parent?: FakeDirectory,
  ) {}
  get path(): string { return this.parent ? (this.parent.path ? `${this.parent.path}/${this.name}` : this.name) : '' }
  async queryPermission() { return 'granted' }
  async requestPermission() { return 'granted' }
  async isSameEntry(other: unknown) { return other === this }
  async *entries() { yield* this.items.entries() }
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectory> {
    const item = this.items.get(name)
    if (item && item.kind !== 'directory') throw new DOMException('Not a folder', 'TypeMismatchError')
    if (item) return item
    if (!options?.create) throw new DOMException('Missing folder', 'NotFoundError')
    this.events.push(`mkdir:${this.path ? `${this.path}/` : ''}${name}`)
    const directory = new FakeDirectory(name, this.events, this.controls, this)
    this.items.set(name, directory)
    return directory
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFile> {
    const item = this.items.get(name)
    if (item && item.kind !== 'file') throw new DOMException('Not a file', 'TypeMismatchError')
    if (item) return item
    if (!options?.create) throw new DOMException('Missing file', 'NotFoundError')
    this.events.push(`create:${this.path ? `${this.path}/` : ''}${name}`)
    const file = new FakeFile(name, this, '')
    this.items.set(name, file)
    return file
  }
  async removeEntry(name: string) {
    const path = this.path ? `${this.path}/${name}` : name
    this.events.push(`delete:${path}`)
    if (this.controls.failDelete === path) throw new Error('Source deletion denied')
    this.items.delete(name)
  }
  asHandle() { return this as unknown as FileSystemDirectoryHandle }
}

async function fixture(paths: Record<string, string> = { 'old.txt': 'hello, local files' }) {
  const events: string[] = []
  const controls: Controls = {}
  const root = new FakeDirectory('test', events, controls)
  for (const [path, content] of Object.entries(paths)) {
    const parts = path.split('/')
    let directory = root
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create: true })
    directory.items.set(parts[parts.length - 1], new FakeFile(parts[parts.length - 1], directory, content))
  }
  const files = await scanDirectory(root.asHandle(), true)
  const plan = (pairs: Record<string, string>): RenameRow[] => Object.entries(pairs).map(([source, targetPath]) => ({
    file: files.find(file => file.path === source)!,
    targetPath,
    status: 'ready',
  }))
  events.length = 0
  return { root, events, controls, files, plan }
}

const mutations = (events: string[]) => events.filter(event => /^(create|mkdir|open|write|close|delete|move):/.test(event))

beforeEach(() => vi.clearAllMocks())

describe('folder scanning', () => {
  it('keeps IDs stable for rescans while separating identical paths in different roots', async () => {
    const first = await fixture()
    const second = await fixture()
    const rescanned = await scanDirectory(first.root.asHandle(), false)
    expect(first.files[0].path).toBe(second.files[0].path)
    expect(first.files[0].id).not.toBe(second.files[0].id)
    expect(rescanned[0].id).toBe(first.files[0].id)
  })

  it('respects recursive scanning and returns stable relative paths', async () => {
    const { root } = await fixture({ 'a.txt': 'a', 'nested/b.txt': 'b' })
    expect((await scanDirectory(root.asHandle(), false)).map(file => file.path)).toEqual(['a.txt'])
    expect((await scanDirectory(root.asHandle(), true)).map(file => file.path)).toEqual(['a.txt', 'nested/b.txt'])
  })

  it('extracts available image fields without inventing missing metadata', async () => {
    const { root } = await fixture({ 'photo.jpg': 'image' })
    vi.mocked(exifr.parse).mockResolvedValueOnce({ DateTimeOriginal: new Date('2026-05-02T12:00:00Z'), Model: 'X100VI', ExifImageWidth: 6240, ExifImageHeight: 4160 })
    const [file] = await scanDirectory(root.asHandle(), false)
    expect(file.metadata).toEqual({ taken: Date.parse('2026-05-02T12:00:00Z'), camera: 'X100VI', width: 6240, height: 4160 })
    vi.mocked(exifr.parse).mockRejectedValueOnce(new Error('Missing EXIF'))
    expect((await scanDirectory(root.asHandle(), false))[0].metadata).toEqual({})
  })

  it('reads PNG dimensions through the real exifr parser with the selected options', async () => {
    const { root } = await fixture({ 'pixel.png': 'placeholder' })
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5GoAAAAASUVORK5CYII='), character => character.charCodeAt(0))
    const handle = await root.getFileHandle('pixel.png')
    handle.getFile = async () => new File([png], 'pixel.png', { type: 'image/png', lastModified: handle.lastModified })
    const actual = await vi.importActual<typeof import('exifr')>('exifr')
    // Node lacks the browser's FileReader; only adapt the input, preserving the
    // real parser and options to catch errors a canned metadata mock would miss.
    vi.mocked(exifr.parse).mockImplementationOnce(async (file, options) => actual.default.parse(await (file as File).arrayBuffer(), options))
    const [file] = await scanDirectory(root.asHandle(), false)
    expect(file.metadata).toEqual({ width: 1, height: 1 })
  })
})

describe('safe rename execution', () => {
  it('closes and verifies a copy before removing its source, and creates subfolders', async () => {
    const { root, events, plan } = await fixture()
    const progress = vi.fn()
    const result = await applyRenamePlan(root.asHandle(), plan({ 'old.txt': 'archive/new.txt' }), 'copy', progress)
    expect(result.results).toEqual([{ source: 'old.txt', destination: 'archive/new.txt', success: true }])
    expect(root.items.has('old.txt')).toBe(false)
    const archive = await root.getDirectoryHandle('archive')
    expect((await archive.getFileHandle('new.txt')).content).toBe('hello, local files')
    expect(events.indexOf('write:archive/new.txt')).toBeLessThan(events.indexOf('close:archive/new.txt'))
    expect(events.indexOf('close:archive/new.txt')).toBeLessThan(events.indexOf('read:archive/new.txt'))
    expect(events.indexOf('read:archive/new.txt')).toBeLessThan(events.indexOf('delete:old.txt'))
    expect(progress).toHaveBeenCalledWith(1, 1)
  })

  it.each(['existing.txt', 'EXISTING.TXT'])('refuses an existing destination (%s) before making any writes', async target => {
    const { root, events, plan } = await fixture({ 'a.txt': 'a', 'b.txt': 'b', 'existing.txt': 'precious' })
    const result = await applyRenamePlan(root.asHandle(), plan({ 'a.txt': 'safe.txt', 'b.txt': target }), 'copy')
    expect(result.results[0].success).toBe(false)
    expect(result.results[0].error).toContain('already exists')
    expect(mutations(events)).toEqual([])
    expect((await root.getFileHandle('existing.txt')).content).toBe('precious')
  })

  it('refuses an empty destination directory and a file used as a parent', async () => {
    const { root, plan, events } = await fixture({ 'old.txt': 'old', 'blocker': 'file' })
    await root.getDirectoryHandle('folder', { create: true })
    events.length = 0
    const directory = await applyRenamePlan(root.asHandle(), plan({ 'old.txt': 'folder' }), 'copy')
    const blockedParent = await applyRenamePlan(root.asHandle(), plan({ 'old.txt': 'blocker/child.txt' }), 'copy')
    expect(directory.results[0].error).toContain('already exists')
    expect(blockedParent.results[0].error).toContain('blocks the destination folder')
    expect(mutations(events)).toEqual([])
  })

  it.each([
    { 'a.txt': 'one.txt', 'b.txt': 'ONE.txt' },
    { 'a.txt': 'folder', 'b.txt': 'folder/b.txt' },
    { 'a.txt': 'New/a.txt', 'b.txt': 'new/b.txt' },
    { 'a.txt': 'b.txt', 'b.txt': 'c.txt' },
  ])('rejects conflicts anywhere in the full plan', async targets => {
    const { root, events, plan } = await fixture({ 'a.txt': 'a', 'b.txt': 'b' })
    const result = await applyRenamePlan(root.asHandle(), plan(targets), 'copy')
    expect(result.results[0].success).toBe(false)
    expect(mutations(events)).toEqual([])
  })

  it.each(['../escape.txt', '/absolute.txt', 'one/../../escape.txt', 'folder\\file.txt', 'folder//file.txt', 'C:/file.txt'])('rejects unsafe destination %s', async target => {
    const { root, events, plan } = await fixture()
    const result = await applyRenamePlan(root.asHandle(), plan({ 'old.txt': target }), 'copy')
    expect(result.results[0].success).toBe(false)
    expect(mutations(events)).toEqual([])
  })

  it('checks every source for changes before making any writes', async () => {
    const { root, events, plan } = await fixture({ 'a.txt': 'a', 'b.txt': 'b' })
    const modified = await root.getFileHandle('b.txt')
    modified.lastModified++
    const result = await applyRenamePlan(root.asHandle(), plan({ 'a.txt': 'new-a.txt', 'b.txt': 'new-b.txt' }), 'copy')
    expect(result.results[0].error).toContain('Source changed since preview')
    expect(mutations(events)).toEqual([])
  })

  it('detects a replaced handle even when size and modification time match', async () => {
    const { root, events, plan } = await fixture()
    root.items.set('old.txt', new FakeFile('old.txt', root, 'hello, local files'))
    const result = await applyRenamePlan(root.asHandle(), plan({ 'old.txt': 'new.txt' }), 'copy')
    expect(result.results[0].error).toContain('Source was replaced')
    expect(mutations(events)).toEqual([])
  })

  it.each(['failWrite', 'failClose', 'corruptCopy'] as const)('preserves the original when %s prevents a verified copy', async failure => {
    const { root, controls, events, plan } = await fixture()
    controls[failure] = 'new.txt'
    const result = await applyRenamePlan(root.asHandle(), plan({ 'old.txt': 'new.txt' }), 'copy')
    expect(result.results[0].success).toBe(false)
    expect(result.results[0].error).toContain('source was not removed')
    expect((await root.getFileHandle('old.txt')).content).toBe('hello, local files')
    expect(events).not.toContain('delete:old.txt')
  })

  it('preserves a source changed during copying', async () => {
    const { root, controls, events, plan } = await fixture()
    const source = await root.getFileHandle('old.txt')
    controls.onClose = () => { source.lastModified++ }
    const result = await applyRenamePlan(root.asHandle(), plan({ 'old.txt': 'new.txt' }), 'copy')
    expect(result.results[0].error).toContain('Source changed since preview')
    expect(root.items.has('old.txt')).toBe(true)
    expect(root.items.has('new.txt')).toBe(true)
    expect(events).not.toContain('delete:old.txt')
  })

  it('reports a failed source deletion as incomplete and retains the verified destination', async () => {
    const { root, controls, plan } = await fixture()
    controls.failDelete = 'old.txt'
    const result = await applyRenamePlan(root.asHandle(), plan({ 'old.txt': 'new.txt' }), 'copy')
    expect(result.results[0].success).toBe(false)
    expect(result.results[0].error).toContain('verified copy remains')
    expect(root.items.has('old.txt')).toBe(true)
    expect((await root.getFileHandle('new.txt')).content).toBe('hello, local files')
  })

  it('records partial completion and stops on the first runtime failure', async () => {
    const { root, controls, events, plan } = await fixture({ 'a.txt': 'a', 'b.txt': 'b', 'c.txt': 'c' })
    controls.failWrite = 'new-b.txt'
    const result = await applyRenamePlan(root.asHandle(), plan({ 'a.txt': 'new-a.txt', 'b.txt': 'new-b.txt', 'c.txt': 'new-c.txt' }), 'copy')
    expect(result.results.map(row => row.success)).toEqual([true, false])
    expect(root.items.has('a.txt')).toBe(false)
    expect(root.items.has('b.txt')).toBe(true)
    expect(root.items.has('c.txt')).toBe(true)
    expect(events).not.toContain('create:new-c.txt')
  })

  it('refuses unsupported native rename without silently copying', async () => {
    const { root, events, plan } = await fixture()
    const result = await applyRenamePlan(root.asHandle(), plan({ 'old.txt': 'new.txt' }), 'native')
    expect(result.results[0].error).toContain('Native rename is unavailable')
    expect(mutations(events)).toEqual([])
  })

  it('uses native move when present and does not copy after a native rejection', async () => {
    const { root, controls, events, plan } = await fixture()
    const source = await root.getFileHandle('old.txt')
    source.enableNative()
    controls.nativeError = 'Move not supported for local files'
    const failed = await applyRenamePlan(root.asHandle(), plan({ 'old.txt': 'new.txt' }), 'native')
    expect(failed.results[0].success).toBe(false)
    expect(mutations(events)).toEqual(['move:old.txt'])
    controls.nativeError = undefined
    const success = await applyRenamePlan(root.asHandle(), plan({ 'old.txt': 'new.txt' }), 'native')
    expect(success.results[0].success).toBe(true)
    expect(root.items.has('old.txt')).toBe(false)
    expect((await root.getFileHandle('new.txt')).content).toBe('hello, local files')
  })
})

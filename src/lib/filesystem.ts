import exifr from 'exifr'
import type { FileEntry, RenameRow } from './rename'

const MAX_FILES = 10_000
const MAX_ENTRIES = 20_000
const MAX_DEPTH = 32
const rootIds = new WeakMap<FileSystemDirectoryHandle, string>()

function rootId(root: FileSystemDirectoryHandle): string {
  const existing = rootIds.get(root)
  if (existing) return existing
  const id = crypto.randomUUID()
  rootIds.set(root, id)
  return id
}

type MovableHandle = FileSystemFileHandle & {
  move?: (directory: FileSystemDirectoryHandle, name: string) => Promise<void>
}

export interface RenameResult {
  source: string
  destination: string
  success: boolean
  error?: string
}

const pathKey = (path: string) => path.normalize('NFC').toLowerCase()
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Must be called directly from the folder button's click handler. */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  if (typeof window === 'undefined' || typeof window.showDirectoryPicker !== 'function') {
    throw new Error('Opening a local folder requires a supported desktop Chromium browser, such as Chrome or Edge.')
  }
  return window.showDirectoryPicker({ mode: 'readwrite', id: 'renameotron' })
}

async function imageMetadata(file: File): Promise<FileEntry['metadata']> {
  if (!/\.(jpe?g|tiff?|heic|heif|avif|png)$/i.test(file.name)) return {}
  try {
    const tags = await exifr.parse(file, {
      // A global pick filter suppresses PNG's IHDR segment in exifr. Limit the
      // TIFF fields inside their own block so PNG dimensions remain available.
      tiff: { pick: ['DateTimeOriginal', 'Model', 'ExifImageWidth', 'ExifImageHeight', 'ImageWidth', 'ImageHeight'] },
      gps: false,
      ihdr: true,
    }) as Record<string, unknown> | undefined
    if (!tags) return {}
    const metadata: FileEntry['metadata'] = {}
    if (tags.DateTimeOriginal instanceof Date && Number.isFinite(tags.DateTimeOriginal.getTime())) {
      metadata.taken = tags.DateTimeOriginal.getTime()
    }
    if (typeof tags.Model === 'string' && tags.Model.trim()) metadata.camera = tags.Model.trim()
    const width = tags.ExifImageWidth ?? tags.ImageWidth ?? tags.width
    const height = tags.ExifImageHeight ?? tags.ImageHeight ?? tags.height
    if (typeof width === 'number' && width > 0) metadata.width = width
    if (typeof height === 'number' && height > 0) metadata.height = height
    return metadata
  } catch {
    // Missing, unsupported, or damaged embedded metadata is not a file-read failure.
    // The preview engine flags tokens that require an unavailable field.
    return {}
  }
}

/** A complete snapshot, never a silently truncated listing. No files are modified. */
export async function scanDirectory(root: FileSystemDirectoryHandle, recursive: boolean): Promise<FileEntry[]> {
  const files: FileEntry[] = []
  const namespace = rootId(root)
  let entryCount = 0
  async function visit(directory: FileSystemDirectoryHandle, prefix: string, depth: number) {
    if (depth > MAX_DEPTH) throw new Error(`Folders deeper than ${MAX_DEPTH} levels are not supported in this preview.`)
    const pending: Array<{ name: string; path: string; handle: FileSystemFileHandle }> = []
    async function flush() {
      files.push(...await Promise.all(pending.map(async ({ name, path, handle }) => {
        const file = await handle.getFile()
        return {
          id: `${namespace}:${path}`,
          name,
          path,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
          metadata: await imageMetadata(file),
          handle,
          parent: directory,
        }
      })))
      pending.length = 0
    }
    for await (const [name, handle] of directory.entries()) {
      if (++entryCount > MAX_ENTRIES) throw new Error(`This folder exceeds the ${MAX_ENTRIES.toLocaleString()} entry preview limit. Choose a smaller folder.`)
      const path = prefix ? `${prefix}/${name}` : name
      if (handle.kind === 'directory') {
        if (recursive) {
          await flush()
          await visit(handle, path, depth + 1)
        }
        continue
      }
      if (files.length + pending.length >= MAX_FILES) throw new Error(`This folder exceeds the ${MAX_FILES.toLocaleString()} file preview limit. Choose a smaller folder.`)
      pending.push({ name, path, handle })
      if (pending.length >= 12) await flush()
    }
    await flush()
  }
  await visit(root, '', 0)
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }))
}

function splitPath(path: string, destination = false): string[] {
  const parts = path.split('/')
  if (!path || path.length > 4096 || path.includes('\\') || parts.some(part => !part || part === '.' || part === '..' || /[\u0000-\u001f]/.test(part))) {
    throw new Error('Paths must stay inside the selected folder and cannot contain empty, dot, or parent segments.')
  }
  if (destination && parts.some(part => part.length > 255 || /[<>:"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('The destination contains a filename that is not portable across supported file systems.')
  }
  return parts
}

type DirectoryIndex = Map<string, Promise<Map<string, FileSystemHandle>>>

async function children(directory: FileSystemDirectoryHandle): Promise<Map<string, FileSystemHandle>> {
  const entries = new Map<string, FileSystemHandle>()
  for await (const [name, handle] of directory.entries()) {
    const key = pathKey(name)
    if (entries.has(key)) throw new Error(`The folder contains ambiguous names differing only by case or Unicode normalization: ${name}`)
    entries.set(key, handle)
  }
  return entries
}

async function indexedChildren(directory: FileSystemDirectoryHandle, path: string, cache?: DirectoryIndex) {
  if (!cache) return children(directory)
  if (!cache.has(path)) cache.set(path, children(directory))
  return cache.get(path)!
}

/** Check the complete destination path, including case-insensitive collisions. */
async function destinationParent(
  root: FileSystemDirectoryHandle,
  parts: string[],
  create: boolean,
  cache?: DirectoryIndex,
): Promise<FileSystemDirectoryHandle | undefined> {
  let directory = root
  let directoryPath = ''
  for (const part of parts.slice(0, -1)) {
    const existing = (await indexedChildren(directory, directoryPath, cache)).get(pathKey(part))
    if (existing) {
      if (existing.kind !== 'directory') throw new Error(`A file blocks the destination folder: ${part}`)
      if (existing.name !== part) throw new Error(`Folder name differs by case or Unicode normalization: ${part}`)
      directory = existing as FileSystemDirectoryHandle
    } else {
      if (!create) return undefined
      directory = await directory.getDirectoryHandle(part, { create: true })
    }
    directoryPath = directoryPath ? `${directoryPath}/${part}` : part
  }
  const leaf = parts[parts.length - 1]
  if ((await indexedChildren(directory, directoryPath, cache)).has(pathKey(leaf))) {
    throw new Error(`Destination already exists: ${parts.join('/')}. Existing entries are never intentionally overwritten.`)
  }
  return directory
}

async function currentSource(root: FileSystemDirectoryHandle, entry: FileEntry) {
  const parts = splitPath(entry.path)
  if (!entry.handle || entry.name !== parts[parts.length - 1]) throw new Error('The source file does not have a valid local handle. Refresh the folder.')
  let parent = root
  for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part)
  const handle = await parent.getFileHandle(parts[parts.length - 1])
  if (!await handle.isSameEntry(entry.handle)) throw new Error(`Source was replaced since preview: ${entry.path}. Refresh the folder.`)
  const file = await handle.getFile()
  if (file.size !== entry.size || file.lastModified !== entry.lastModified) {
    throw new Error(`Source changed since preview: ${entry.path}. Refresh the folder.`)
  }
  return { parent, handle, file }
}

/**
 * Preflight the whole plan, then stop at the first failure. Browser file APIs do
 * not offer transactions or exclusive create/rename: external edits between a
 * check and an operation cannot be eliminated. Callers must show that limitation.
 * Copy mode is explicit, and a failure never triggers automatic copy fallback.
 */
export async function applyRenamePlan(
  root: FileSystemDirectoryHandle,
  rows: RenameRow[],
  method: 'native' | 'copy',
  onProgress?: (completed: number, total: number) => void,
): Promise<{ results: RenameResult[] }> {
  const ready = rows.filter(row => row.status === 'ready')
  const results: RenameResult[] = []
  if (!ready.length) return { results }
  let active = ready[0]
  const cache: DirectoryIndex = new Map()
  try {
    if (await root.queryPermission({ mode: 'readwrite' }) !== 'granted' && await root.requestPermission({ mode: 'readwrite' }) !== 'granted') {
      throw new Error('Write permission was not granted for this folder.')
    }
    const targets = new Set<string>()
    const sources = new Set<string>()
    const plannedDirectories = new Map<string, string>()
    for (const row of ready) {
      active = row
      const parts = splitPath(row.targetPath, true)
      const key = pathKey(parts.join('/'))
      if (targets.has(key)) throw new Error(`Multiple files have the same destination: ${row.targetPath}`)
      targets.add(key)
      if (sources.has(pathKey(row.file.path))) throw new Error(`The source appears more than once: ${row.file.path}`)
      sources.add(pathKey(row.file.path))
      if (key === pathKey(row.file.path)) throw new Error('Unchanged and case-only renames are not supported.')
      for (let i = 1; i < parts.length; i++) {
        const directory = parts.slice(0, i).join('/')
        const existing = plannedDirectories.get(pathKey(directory))
        if (existing && existing !== directory) throw new Error(`Planned folders differ by case or Unicode normalization: ${directory}`)
        plannedDirectories.set(pathKey(directory), directory)
      }
    }
    for (const row of ready) {
      active = row
      const parts = splitPath(row.targetPath, true)
      for (let i = 1; i < parts.length; i++) {
        if (targets.has(pathKey(parts.slice(0, i).join('/')))) throw new Error(`A planned file blocks a destination folder: ${row.targetPath}`)
      }
      const source = await currentSource(root, row.file)
      if (method === 'native' && typeof (source.handle as MovableHandle).move !== 'function') {
        throw new Error('Native rename is unavailable in this browser. Select Copy & delete explicitly to use that method.')
      }
      await destinationParent(root, parts, false, cache)
    }
  } catch (error) {
    return { results: [{ source: active.file.path, destination: active.targetPath, success: false, error: errorMessage(error) }] }
  }

  for (const row of ready) {
    let destinationCreated = false
    let copyVerified = false
    try {
      const source = await currentSource(root, row.file)
      const parts = splitPath(row.targetPath, true)
      // Repeat collision checks immediately before each operation; no cached state.
      const parent = (await destinationParent(root, parts, true))!
      const name = parts[parts.length - 1]
      if (method === 'native') {
        await (source.handle as MovableHandle).move!(parent, name)
      } else {
        const destination = await parent.getFileHandle(name, { create: true })
        destinationCreated = true
        const writable = await destination.createWritable()
        try {
          await writable.write(source.file)
          await writable.close()
        } catch (error) {
          try { await writable.abort() } catch { /* A failed close may already have closed the stream. */ }
          throw error
        }
        const written = await destination.getFile()
        if (written.size !== source.file.size) throw new Error('Destination size verification failed.')
        copyVerified = true
        // Do not delete a source which changed while the copy was being written.
        const unchanged = await currentSource(root, row.file)
        await unchanged.parent.removeEntry(row.file.name)
      }
      results.push({ source: row.file.path, destination: row.targetPath, success: true })
      try { onProgress?.(results.length, ready.length) } catch { /* Progress observers cannot change disk-operation outcomes. */ }
    } catch (error) {
      const detail = destinationCreated
        ? copyVerified ? ' A verified copy remains at the destination; the source was not intentionally removed.' : ' The source was not removed. A partial destination file may remain.'
        : ''
      results.push({ source: row.file.path, destination: row.targetPath, success: false, error: errorMessage(error) + detail })
      break
    }
  }
  return { results }
}

import type { HighlightSpan } from './highlight-types'
import { expandReplacementMetadata, getReplacementOutputHighlights } from './replacement-output'
import { applyMetadataModifiers, formatReadableBytes, formatUtcDate, MetadataUnavailableError, validateDateFormat, type MetadataValue } from './metadata-modifiers'

export interface FileEntry {
  id: string
  name: string
  /** Path relative to the selected directory, using forward slashes. */
  path: string
  size: number
  type: string
  lastModified: number
  metadata: Record<string, string | number | undefined>
  handle?: FileSystemFileHandle
  parent?: FileSystemDirectoryHandle
}

export interface RenameRow {
  file: FileEntry
  targetPath: string
  /** Generated portions of targetPath, including any preserved parent offset. */
  targetHighlights?: HighlightSpan[]
  status: 'ready' | 'unmatched' | 'unchanged' | 'error'
  error?: string
}

export interface RenamePlan {
  rows: RenameRow[]
  error?: string
  matchedCount: number
  readyCount: number
  errorCount: number
}

export interface TokenDefinition {
  key: string
  label: string
  description: string
  example: string
}

export const TOKEN_DEFINITIONS: TokenDefinition[] = [
  { key: 'name', label: 'File name', description: 'Original name without its extension.', example: '{name}' },
  { key: 'ext', label: 'Extension', description: 'Original extension without the dot.', example: '{ext}' },
  { key: 'index', label: 'Sequence', description: 'Starts at 1; :3 pads to three digits. Selected matches only.', example: '{index:3}' },
  { key: 'uuid', label: 'Unique ID', description: 'A stable UUID for this file during this session.', example: '{uuid}' },
  { key: 'modified', label: 'Modified date', description: 'File modification date in UTC. YYYY, MM, DD, HH, mm, ss.', example: '{modified:YYYY-MM-DD}' },
  { key: 'taken', label: 'Capture date', description: 'Photo capture date in UTC; requires embedded metadata.', example: '{taken:YYYY-MM-DD}' },
  { key: 'camera', label: 'Camera', description: 'Camera model from embedded photo metadata.', example: '{camera}' },
  { key: 'width', label: 'Width', description: 'Image width in pixels; requires image metadata.', example: '{width}' },
  { key: 'height', label: 'Height', description: 'Image height in pixels; requires image metadata.', example: '{height}' },
  { key: 'dimensions', label: 'Dimensions', description: 'Image width and height, for example 6240x4160.', example: '{dimensions}' },
  { key: 'aspect', label: 'Aspect ratio', description: 'Reduced image aspect ratio, for example 3x2. Uses x for portable file names.', example: '{aspect}' },
  { key: 'megapixels', label: 'Megapixels', description: 'Image pixel count in millions, rounded to two decimal places.', example: '{megapixels}' },
  { key: 'orientation', label: 'Orientation', description: 'Image orientation: landscape, portrait, or square.', example: '{orientation}' },
  { key: 'size', label: 'Size', description: 'File size in bytes.', example: '{size}' },
  { key: 'type', label: 'MIME type', description: 'Browser-reported MIME type, e.g. image/jpeg. Slashes create folders.', example: '{type}' },
]

const uuids = new Map<string, string>()

function fileUuid(file: FileEntry): string {
  const cached = uuids.get(file.id)
  if (cached) return cached
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  uuids.set(file.id, uuid)
  return uuid
}

function splitName(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf('.')
  return dot > 0
    ? { stem: name.slice(0, dot), extension: name.slice(dot + 1) }
    : { stem: name, extension: '' }
}

function dateToken(value: string | number | undefined, format: string | undefined, label: string): string | Date {
  if (value === undefined || value === '') throw new MetadataUnavailableError(`Missing ${label.toLowerCase()} metadata.`)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new MetadataUnavailableError(`Invalid ${label.toLowerCase()} metadata.`)
  return format === undefined ? date : formatUtcDate(date, format)
}

/** Validate token names and legacy formats before a file is available. */
export function validateTokenFormat(key: string, format: string | undefined): void {
  if (!TOKEN_DEFINITIONS.some(token => token.key === key)) {
    throw new Error(`Unknown token {${key}}. Choose a token from the metadata menu.`)
  }
  if (key === 'modified' || key === 'taken') {
    if (format !== undefined) validateDateFormat(format, key === 'modified' ? 'Modified date' : 'Capture date')
    return
  }
  if (key === 'index') {
    if (format !== undefined && (!/^\d+$/.test(format) || Number(format) < 1 || Number(format) > 12)) {
      throw new Error('Index padding must be a number from 1 to 12, e.g. {index:3}.')
    }
    return
  }
  if (format !== undefined) throw new Error(`The {${key}} token does not accept a format.`)
}

function imageDimensions(file: FileEntry): { width: number; height: number } {
  const values = ['width', 'height'].map(key => {
    const raw = file.metadata[key]
    if (raw === undefined || raw === '') throw new MetadataUnavailableError(`Missing ${key} metadata.`)
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value <= 0) throw new MetadataUnavailableError(`Invalid ${key} metadata. Image dimensions must be positive whole numbers.`)
    return value
  })
  return { width: values[0], height: values[1] }
}

function resolveTokenValue(file: FileEntry, key: string, format: string | undefined, index: number): MetadataValue {
  validateTokenFormat(key, format)
  const { stem, extension } = splitName(file.name)
  if (key === 'modified') return dateToken(file.lastModified, format, 'Modified date')
  if (key === 'taken') return dateToken(file.metadata.taken, format, 'Capture date')
  if (key === 'index') {
    return index.toString().padStart(Number(format ?? 1), '0')
  }
  if (key === 'name') return stem
  if (key === 'ext') return extension
  if (key === 'uuid') return fileUuid(file)
  if (key === 'size') return String(file.size)
  if (key === 'type') {
    if (!file.type) throw new MetadataUnavailableError('Missing MIME type metadata.')
    return file.type
  }
  if (['camera', 'width', 'height'].includes(key)) {
    const value = file.metadata[key]
    if (value === undefined || value === '') throw new MetadataUnavailableError(`Missing ${key} metadata.`)
    return String(value)
  }
  if (['dimensions', 'aspect', 'megapixels', 'orientation'].includes(key)) {
    const { width, height } = imageDimensions(file)
    if (key === 'dimensions') return `${width}x${height}`
    if (key === 'megapixels') return String(Number((width * height / 1_000_000).toFixed(2)))
    if (key === 'orientation') return width === height ? 'square' : width > height ? 'landscape' : 'portrait'
    let divisor = width
    let remainder = height
    while (remainder !== 0) [divisor, remainder] = [remainder, divisor % remainder]
    return `${width / divisor}x${height / divisor}`
  }
  throw new Error(`Unknown token {${key}}. Choose a token from the metadata menu.`)
}

/** Shared resolver for previews and the metadata editor. Modifiers run left to right. */
export function resolveFileToken(file: FileEntry, key: string, format: string | undefined, index: number, modifiers: string[] = []): string {
  let value: MetadataValue
  let unavailableError: MetadataUnavailableError | undefined
  try {
    value = resolveTokenValue(file, key, format, index)
  } catch (error) {
    if (!(error instanceof MetadataUnavailableError)) throw error
    unavailableError = error
  }
  return applyMetadataModifiers(value, modifiers, unavailableError)
}

export interface FileTokenDetail extends TokenDefinition {
  /** Exact output of the example pattern; undefined means unavailable. */
  value?: string
  /** Full metadata value when the example formats it (for example, dates). */
  displayValue?: string
  error?: string
}

/** Use the rename engine's resolver so the inspector and preview agree. */
export function getFileTokenDetails(file: FileEntry, index?: number): FileTokenDetail[] {
  return TOKEN_DEFINITIONS.map(token => {
    try {
      if (token.key === 'index' && index === undefined) {
        return { ...token, error: 'Select this file and match its name to assign a sequence number.' }
      }
      const format = token.example.slice(1, -1).split(':')[1]
      const value = resolveFileToken(file, token.key, format, index ?? 1)
      const displayValue = token.key === 'modified' || token.key === 'taken'
        ? `${resolveFileToken(file, token.key, 'YYYY-MM-DD HH:mm:ss', index ?? 1)} UTC`
        : value
      return { ...token, value, displayValue }
    } catch (error) {
      return { ...token, error: error instanceof Error ? error.message : 'Metadata unavailable.' }
    }
  })
}

/** Validate portable paths before any file-system operation. */
export function validateTargetPath(path: string): string | undefined {
  if (!path || !path.trim()) return 'The new file name is empty.'
  if (path.length > 4096) return 'Destination paths cannot exceed 4096 characters.'
  if (path.startsWith('/') || /^[a-z]:/i.test(path)) return 'Use a path relative to the selected folder.'
  if (path.includes('\\')) return 'Use forward slashes (/) for subfolders.'
  const segments = path.split('/')
  for (const segment of segments) {
    if (!segment) return 'Folder and file names cannot be empty.'
    if (segment.length > 255) return 'File and folder names cannot exceed 255 characters.'
    if (segment === '.' || segment === '..') return 'Paths cannot contain . or .. segments.'
    if (/[<>:"|?*\u0000-\u001f\u007f]/.test(segment)) return 'File names cannot contain control characters or < > : " | ? *.'
    if (/[. ]$/.test(segment)) return 'File and folder names cannot end with a space or dot.'
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) return `“${segment}” is a reserved file name.`
  }
  return undefined
}

function canonicalPath(path: string): string {
  return path.normalize('NFC').toLowerCase()
}

function parents(path: string): string[] {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
}

/**
 * Match the file name (not its path). Native JavaScript replacement captures work.
 * Plain output names stay in their original parent; output containing / starts at
 * the selected root. Indices follow input order and count selected matches only.
 * Destinations already occupied by any source are blocked: no dependent renames.
 */
export function buildRenamePlan(
  files: FileEntry[],
  pattern: string,
  replacement: string,
  flags = 'i',
  selectedIds?: Set<string>,
): RenamePlan {
  const initialRows: RenameRow[] = files.map((file) => ({ file, targetPath: file.path, status: 'unmatched' }))
  if (!pattern) return { rows: initialRows, matchedCount: 0, readyCount: 0, errorCount: 0 }
  let regex: RegExp
  try {
    regex = new RegExp(pattern, flags)
  } catch (error) {
    return { rows: initialRows, error: error instanceof Error ? error.message : 'Invalid regular expression.', matchedCount: 0, readyCount: 0, errorCount: 0 }
  }

  let matchedCount = 0
  const rows = initialRows.map((row): RenameRow => {
    const { file } = row
    if (selectedIds && !selectedIds.has(file.id)) return row
    regex.lastIndex = 0
    if (!regex.test(file.name)) return row
    matchedCount++
    let targetPath = file.path
    let targetHighlights: HighlightSpan[] | undefined
    try {
      // Resolve tokens before captures so braces in source names stay literal.
      // Escape $ inside metadata to keep it out of the replacement grammar.
      const expanded = expandReplacementMetadata(replacement, (key, format, modifiers) => resolveFileToken(file, key, format, matchedCount, modifiers))
      regex.lastIndex = 0
      const targetName = file.name.replace(regex, expanded.text)
      if (!targetName) throw new Error('The new file name is empty.')
      const parent = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/') + 1) : ''
      targetPath = targetName.includes('/') ? targetName : `${parent}${targetName}`
      const parentOffset = targetName.includes('/') ? 0 : parent.length
      targetHighlights = getReplacementOutputHighlights(file.name, regex, expanded, targetName)
        .map(span => ({ ...span, start: span.start + parentOffset, end: span.end + parentOffset }))
      if (targetPath === file.path) return { file, targetPath, targetHighlights, status: 'unchanged' }
      const pathError = validateTargetPath(targetPath)
      if (pathError) throw new Error(pathError)
      return { file, targetPath, targetHighlights, status: 'ready' }
    } catch (error) {
      return { file, targetPath, targetHighlights, status: 'error', error: error instanceof Error ? error.message : 'Could not build this file name.' }
    }
  })

  const existingFiles = new Set(files.map((file) => canonicalPath(file.path)))
  const existingDirectories = new Map<string, Set<string>>()
  for (const file of files) {
    for (const parent of parents(file.path)) {
      const key = canonicalPath(parent)
      const spellings = existingDirectories.get(key) ?? new Set<string>()
      spellings.add(parent)
      existingDirectories.set(key, spellings)
    }
  }
  const targets = new Map<string, RenameRow[]>()
  const plannedDirectories = new Map<string, Map<string, RenameRow[]>>()
  for (const row of rows) {
    if (row.status !== 'ready') continue
    const target = canonicalPath(row.targetPath)
    targets.set(target, [...(targets.get(target) ?? []), row])
    for (const parent of parents(row.targetPath)) {
      const key = canonicalPath(parent)
      const spellings = plannedDirectories.get(key) ?? new Map<string, RenameRow[]>()
      spellings.set(parent, [...(spellings.get(parent) ?? []), row])
      plannedDirectories.set(key, spellings)
    }
  }
  const setError = (row: RenameRow, error: string) => {
    row.status = 'error'
    row.error ??= error
  }
  for (const spellings of plannedDirectories.values()) {
    if (spellings.size > 1) {
      for (const affectedRows of spellings.values()) {
        for (const row of affectedRows) setError(row, 'Planned folders differ only by case or Unicode normalization.')
      }
    }
  }
  for (const [target, targetRows] of targets) {
    for (const row of targetRows) {
      if (targetRows.length > 1) setError(row, 'Multiple files would have the same destination.')
      if (existingFiles.has(target)) {
        setError(row, target === canonicalPath(row.file.path)
          ? 'Case-only or equivalent Unicode renames are not supported in this preview.'
          : 'A file already exists at this destination.')
      }
      if (existingDirectories.has(target)) setError(row, 'A folder already exists at this destination.')
      for (const parent of parents(row.targetPath)) {
        const existing = existingDirectories.get(canonicalPath(parent))
        if (existing && (existing.size > 1 || !existing.has(parent))) {
          setError(row, 'A destination folder differs from an existing folder by case or Unicode normalization.')
        }
      }
      if (parents(target).some((parent) => existingFiles.has(parent))) setError(row, 'A file blocks a required destination folder.')
      for (const parent of parents(target)) {
        const blockingRows = targets.get(parent)
        if (blockingRows) {
          setError(row, 'A planned file conflicts with a required destination folder.')
          for (const blockingRow of blockingRows) setError(blockingRow, 'This destination is also needed as a folder.')
        }
      }
    }
  }

  return {
    rows,
    matchedCount,
    readyCount: rows.filter((row) => row.status === 'ready').length,
    errorCount: rows.filter((row) => row.status === 'error').length,
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  return formatReadableBytes(bytes)
}

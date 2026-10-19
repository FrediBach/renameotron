import type { HighlightSpan } from './highlight-types'
import { expandReplacementMetadata, getReplacementOutputHighlights } from './replacement-output'
import { formatReadableBytes } from './metadata-modifiers'
import { resolveFileToken } from './metadata-values'
import { compileConditionalPattern } from './conditional-pattern'

export { TOKEN_DEFINITIONS, resolveFileToken, validateTokenFormat, getFileTokenDetails, type TokenDefinition, type FileTokenDetail } from './metadata-values'

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
  replacementError?: string
  matchedCount: number
  readyCount: number
  errorCount: number
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

  let compiled: ReturnType<typeof compileConditionalPattern> | undefined
  let replacementError: string | undefined
  try {
    compiled = compileConditionalPattern(replacement)
  } catch (error) {
    replacementError = error instanceof Error ? error.message : 'Invalid replacement pattern.'
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
      if (!compiled) throw new Error(replacementError)
      // Resolve tokens before captures so braces in source names stay literal.
      // Escape $ inside metadata to keep it out of the replacement grammar.
      const expanded = expandReplacementMetadata(compiled.render(file, matchedCount), (key, format, modifiers) => resolveFileToken(file, key, format, matchedCount, modifiers))
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
    ...(replacementError ? { replacementError } : {}),
    matchedCount,
    readyCount: rows.filter((row) => row.status === 'ready').length,
    errorCount: rows.filter((row) => row.status === 'error').length,
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  return formatReadableBytes(bytes)
}

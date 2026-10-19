import { formatBytes, getFileTokenDetails, TOKEN_DEFINITIONS, type FileEntry, type FileTokenDetail, type RenameRow } from './rename'
import { compileFileSearch } from './file-search'

export interface PreviewColumn {
  id: string
  label: string
  description: string
  group: string
  width: number
}

export interface PreviewValue {
  text: string
  sortValue: string | number | null
  searchText?: string
}

export interface PreviewRecord {
  row: RenameRow
  values: Record<string, PreviewValue>
}

export interface PreviewSort {
  columnId: string
  direction: 'asc' | 'desc'
}

export interface PreviewSelectionOptions {
  search: string
  filters: Record<string, string>
  sort: PreviewSort | null
  matchedOnly: boolean
}

export const DEFAULT_COLUMN_IDS = ['from', 'to', 'size']

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const tokenKeys = new Set(TOKEN_DEFINITIONS.map(token => token.key))
const numericTokens = new Set(['index', 'width', 'height', 'size', 'megapixels'])
const dateTokens = new Set(['modified', 'taken'])
const unavailable: PreviewValue = { text: '—', sortValue: null, searchText: 'Not available' }

function tokenGroup(key: string): string {
  if (['taken', 'camera', 'width', 'height'].includes(key)) return 'Photo metadata'
  if (['dimensions', 'aspect', 'megapixels', 'orientation'].includes(key)) return 'Calculated image details'
  if (['index', 'uuid'].includes(key)) return 'Generated values'
  return 'File details'
}

function tokenWidth(key: string): number {
  if (dateTokens.has(key)) return 220
  if (key === 'uuid') return 310
  if (['size', 'index', 'ext', 'width', 'height', 'megapixels'].includes(key)) return 110
  if (key === 'name') return 240
  return 170
}

/** Every supported token is available, even when the current files lack its metadata. */
export function getPreviewColumns(files: FileEntry[]): PreviewColumn[] {
  const extraKeys = new Set<string>()
  for (const file of files) {
    for (const key of Object.keys(file.metadata)) {
      if (!tokenKeys.has(key)) extraKeys.add(key)
    }
  }
  return [
    { id: 'from', label: 'From', description: 'Original file path relative to the selected folder.', group: 'Preview', width: 330 },
    { id: 'to', label: 'To', description: 'Proposed file path relative to the selected folder.', group: 'Preview', width: 330 },
    { id: 'status', label: 'Status', description: 'Ready, unchanged, no match, excluded, or error.', group: 'Preview', width: 130 },
    ...TOKEN_DEFINITIONS.map(token => ({
      id: token.key,
      label: token.label,
      description: token.description,
      group: tokenGroup(token.key),
      width: tokenWidth(token.key),
    })),
    ...Array.from(extraKeys).sort(collator.compare).map(key => ({
      id: `metadata:${key}`,
      label: key.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, letter => letter.toUpperCase()),
      description: `Embedded metadata: ${key}.`,
      group: 'Other metadata',
      width: 170,
    })),
  ]
}

function tokenValue(detail: FileTokenDetail, file: FileEntry, sequence: number | undefined): PreviewValue {
  if (detail.value === undefined) return unavailable
  if (detail.key === 'index') {
    return sequence === undefined ? unavailable : { text: String(sequence), sortValue: sequence }
  }
  if (detail.key === 'size') {
    return Number.isFinite(file.size) && file.size >= 0
      ? { text: formatBytes(file.size), sortValue: file.size, searchText: `${formatBytes(file.size)} ${file.size} bytes` }
      : unavailable
  }
  if (detail.key === 'ext' && detail.value === '') return { text: 'No extension', sortValue: '' }
  const text = detail.displayValue ?? detail.value
  if (dateTokens.has(detail.key)) {
    const raw = detail.key === 'modified' ? file.lastModified : file.metadata.taken
    const timestamp = raw === undefined ? NaN : new Date(raw).getTime()
    return Number.isFinite(timestamp) ? { text, sortValue: timestamp } : unavailable
  }
  if (numericTokens.has(detail.key)) {
    const value = Number(detail.value)
    return Number.isFinite(value) ? { text, sortValue: value } : unavailable
  }
  return { text, sortValue: text }
}

function extraMetadataValue(raw: string | number | undefined): PreviewValue {
  if (raw === undefined || raw === '') return unavailable
  if (typeof raw === 'number') return Number.isFinite(raw) ? { text: String(raw), sortValue: raw } : unavailable
  // Numeric metadata is often decoded as text; preserve its display while sorting by value.
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim())) {
    const number = Number(raw)
    if (Number.isFinite(number)) return { text: raw, sortValue: number }
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const timestamp = Date.parse(raw)
    if (Number.isFinite(timestamp)) return { text: raw, sortValue: timestamp }
  }
  return { text: raw, sortValue: raw }
}

/** Build values before presentation filtering/sorting so sequence numbers keep their rename meaning. */
export function buildPreviewRecords(rows: RenameRow[], selectedIds: Set<string>): PreviewRecord[] {
  const extraColumns = getPreviewColumns(rows.map(row => row.file)).filter(column => column.id.startsWith('metadata:'))
  let sequence = 0
  return rows.map(row => {
    const index = row.status === 'unmatched' ? undefined : ++sequence
    const status = !selectedIds.has(row.file.id) ? 'Excluded'
      : row.status === 'unmatched' ? 'No match'
        : row.status === 'ready' ? 'Ready'
          : row.status === 'unchanged' ? 'Unchanged' : 'Error'
    const targetText = row.status === 'unmatched' ? status : row.targetPath
    const values: Record<string, PreviewValue> = {
      from: { text: row.file.path, sortValue: row.file.path },
      to: { text: targetText, sortValue: targetText, searchText: row.error },
      status: { text: status, sortValue: status, searchText: `${status} ${row.error ?? ''}`.trim() },
    }
    for (const detail of getFileTokenDetails(row.file, index)) values[detail.key] = tokenValue(detail, row.file, index)
    for (const column of extraColumns) values[column.id] = extraMetadataValue(row.file.metadata[column.id.slice('metadata:'.length)])
    return { row, values }
  })
}

function normalized(value: string): string {
  return value.normalize('NFC').toLowerCase()
}

function includesQuery(value: PreviewValue | undefined, query: string): boolean {
  return value !== undefined && normalized(`${value.text} ${value.searchText ?? ''}`).includes(query)
}

/** Search all metadata, combine column filters with AND, and only reorder the view. */
export function selectPreviewRecords(records: PreviewRecord[], options: PreviewSelectionOptions, query = compileFileSearch(options.search)): PreviewRecord[] {
  const filters = Object.entries(options.filters)
    .map(([id, value]) => [id, normalized(value.trim())] as const)
    .filter(([, value]) => value !== '')
  const visible = records.filter(record => {
    if (options.matchedOnly && record.row.status === 'unmatched') return false
    if (!query.matches(record)) return false
    return filters.every(([id, filter]) => includesQuery(record.values[id], filter))
  })
  const sort = options.sort
  if (!sort) return visible
  const direction = sort.direction === 'asc' ? 1 : -1
  return visible.sort((a, b) => {
    const left = a.values[sort.columnId]?.sortValue ?? null
    const right = b.values[sort.columnId]?.sortValue ?? null
    // Missing values stay last in either direction. Stable sort preserves input order for ties.
    if (left === null) return right === null ? 0 : 1
    if (right === null) return -1
    return direction * (typeof left === 'number' && typeof right === 'number'
      ? left - right
      : collator.compare(String(left), String(right)))
  })
}

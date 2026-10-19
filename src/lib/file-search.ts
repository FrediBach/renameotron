import type { PreviewRecord } from './preview-table'
import { compileFileQuery, normalizeQueryText, readFileType, readMetadataValue, type FileQueryError, type SearchValue } from './file-query'

export type FileSearchError = FileQueryError

export interface CompiledFileSearch {
  matches: (record: PreviewRecord) => boolean
  error?: FileSearchError
}

function fieldReader(field: string): (record: PreviewRecord) => SearchValue {
  if (field.startsWith('metadata.')) return record => readMetadataValue(record.row.file.metadata, field.slice('metadata.'.length))
  if (field === 'name') return record => record.row.file.name || undefined
  if (field === 'type') return record => readFileType(record.row.file)
  if (field === 'aspect') return record => {
    const width = record.values.width?.sortValue
    const height = record.values.height?.sortValue
    return typeof width === 'number' && typeof height === 'number' && Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 ? width / height : undefined
  }
  return record => {
    const value = record.values[field]?.sortValue
    return value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value)) ? undefined : value
  }
}

/** Compile once per query. Invalid filters return no matches and a displayable error. */
export function compileFileSearch(query: string): CompiledFileSearch {
  return compileFileQuery(query, {
    readField: fieldReader,
    searchText: query => record => Object.values(record.values).some(value => normalizeQueryText(`${value.text} ${value.searchText ?? ''}`).includes(query)),
  })
}

import type { FileEntry } from './rename'
import { compileFileQuery, readFileType, readMetadataValue, type FileQueryError, type SearchValue } from './file-query'
import { MetadataUnavailableError } from './metadata-modifiers'

export interface CompiledMetadataCondition {
  matches: (file: FileEntry, index: number) => boolean
  error?: FileQueryError
}

/** Inject the naming resolver so query compilation never depends on rename plans. */
export type ConditionTokenResolver = (file: FileEntry, key: string, format: string | undefined, index: number) => string

interface SourceContext { file: FileEntry; index: number }

function finiteNumber(value: number): number | undefined {
  return Number.isFinite(value) ? value : undefined
}

function sourceField(field: string, { file, index }: SourceContext, resolveToken: ConditionTokenResolver): SearchValue {
  if (field.startsWith('metadata.')) return readMetadataValue(file.metadata, field.slice('metadata.'.length))
  // Search names include the extension, while the {name} output token does not.
  if (field === 'name') return file.name || undefined
  if (field === 'from') return file.path
  if (field === 'type') return readFileType(file)
  if (field === 'index') return finiteNumber(index)
  if (field === 'size') return file.size >= 0 ? finiteNumber(file.size) : undefined
  if (field === 'modified' || field === 'taken') {
    const raw = field === 'modified' ? file.lastModified : file.metadata.taken
    return raw === undefined || raw === '' ? undefined : finiteNumber(new Date(raw).getTime())
  }
  try {
    if (field === 'aspect') {
      const width = Number(resolveToken(file, 'width', undefined, index))
      const height = Number(resolveToken(file, 'height', undefined, index))
      return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 ? width / height : undefined
    }
    const value = resolveToken(file, field, undefined, index)
    return ['width', 'height', 'megapixels'].includes(field) ? finiteNumber(Number(value)) : value
  } catch (error) {
    if (!(error instanceof MetadataUnavailableError)) throw error
    return undefined
  }
}

/** Source-only conditions share search grammar, comparisons, and missing-value rules. */
export function compileMetadataCondition(query: string, resolveToken: ConditionTokenResolver): CompiledMetadataCondition {
  const compiled = compileFileQuery<SourceContext>(query, {
    readField: field => context => sourceField(field, context, resolveToken),
    allowField: field => field !== 'to' && field !== 'status',
  })
  return {
    matches: (file, index) => compiled.matches({ file, index }),
    ...(compiled.error ? { error: compiled.error } : {}),
  }
}

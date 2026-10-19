export interface FileQueryError {
  message: string
  /** Zero-based character offset in the query. */
  position: number
}

export interface CompiledFileQuery<T> {
  matches: (record: T) => boolean
  error?: FileQueryError
}

export interface FileQueryOptions<T> {
  readField: (field: string) => ValueReader<T>
  /** Omit to require explicit source metadata predicates instead of free text. */
  searchText?: (query: string) => Predicate<T>
  allowField?: (field: string) => boolean
}

type Predicate<T> = CompiledFileQuery<T>['matches']
type Operator = ':' | '=' | '!=' | '>' | '>=' | '<' | '<='
type TokenKind = 'word' | 'string' | 'operator' | 'left' | 'right' | 'minus' | 'end'
interface Token { kind: TokenKind; text: string; position: number; end: number }
export type SearchValue = string | number | undefined
type ValueReader<T> = (record: T) => SearchValue

class SearchSyntaxError extends Error {
  constructor(message: string, readonly position: number) { super(message) }
}

export const normalizeQueryText = (text: string) => text.normalize('NFC').toLowerCase()
function fail(message: string, position: number): never { throw new SearchSyntaxError(message, position) }
const numericFields = new Set(['size', 'width', 'height', 'megapixels', 'index'])
const textFields = new Set(['name', 'from', 'to', 'camera', 'orientation', 'status', 'dimensions', 'uuid', 'ext'])
const categories = new Set(['image', 'video', 'audio', 'document', 'archive'])
const aliases: Record<string, string> = { date: 'modified', filesize: 'size', path: 'from', filename: 'name', extension: 'ext' }
const units: Record<string, number> = {
  b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12,
  kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
}

// Fallbacks apply only when the browser has no useful MIME type for a file.
const extensionTypes: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff',
  heic: 'image/heic', heif: 'image/heif', ico: 'image/x-icon', dng: 'image/x-adobe-dng',
  cr2: 'image/x-canon-cr2', cr3: 'image/x-canon-cr3', nef: 'image/x-nikon-nef', arw: 'image/x-sony-arw', raf: 'image/x-fuji-raf',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo',
  mkv: 'video/x-matroska', mpg: 'video/mpeg', mpeg: 'video/mpeg', wmv: 'video/x-ms-wmv',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac',
  ogg: 'audio/ogg', opus: 'audio/opus', aiff: 'audio/aiff', aif: 'audio/aiff', wma: 'audio/x-ms-wma',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html', htm: 'text/html',
  rtf: 'application/rtf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  epub: 'application/epub+zip', zip: 'application/zip', gz: 'application/gzip', tgz: 'application/gzip',
  tar: 'application/x-tar', '7z': 'application/x-7z-compressed', rar: 'application/vnd.rar', bz2: 'application/x-bzip2', xz: 'application/x-xz',
}

function tokenize(query: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < query.length) {
    if (/\s/.test(query[index])) { index++; continue }
    const position = index
    const char = query[index]
    if (char === '(' || char === ')' || char === '-') {
      tokens.push({ kind: char === '(' ? 'left' : char === ')' ? 'right' : 'minus', text: char, position, end: ++index })
      continue
    }
    if (':=<>!'.includes(char)) {
      index++
      if (query[index] === '=' && '<>!'.includes(char)) index++
      const text = query.slice(position, index)
      if (text === '!') fail('Use NOT or - to exclude a term, or != for a comparison.', position)
      tokens.push({ kind: 'operator', text, position, end: index })
      continue
    }
    if (char === '"' || char === "'") {
      index++
      let text = ''
      while (index < query.length && query[index] !== char) {
        if (query[index] === '\\') {
          if (index + 1 >= query.length) fail('Finish the escape sequence and close the quoted text.', index)
          // Preserve literal backslashes unless escaping the quote or another backslash.
          if (query[index + 1] === char || query[index + 1] === '\\') index++
        }
        text += query[index++]
      }
      if (query[index] !== char) fail('Close the quoted text.', position)
      tokens.push({ kind: 'string', text, position, end: ++index })
      continue
    }
    let text = ''
    let escaped = false
    while (index < query.length && !/[\s:=<>!()'"]/.test(query[index])) {
      if (query[index] === '\\' && index + 1 < query.length) {
        index++
        escaped = true
      }
      text += query[index++]
    }
    tokens.push({ kind: escaped ? 'string' : 'word', text, position, end: index })
  }
  tokens.push({ kind: 'end', text: '', position: query.length, end: query.length })
  return tokens
}

function canonicalField(token: Token): string {
  const field = normalizeQueryText(token.text)
  if (field.startsWith('metadata.') && field.length > 'metadata.'.length) return field
  const canonical = Object.hasOwn(aliases, field) ? aliases[field] : field
  if (textFields.has(canonical) || numericFields.has(canonical) || ['modified', 'taken', 'aspect', 'type'].includes(canonical)) return canonical
  return fail(`Unknown field “${token.text}”. Use a field such as name, type, date, size, or metadata.KEY.`, token.position)
}

/** Read raw metadata with the same case and availability rules in both contexts. */
export function readMetadataValue(metadata: Record<string, string | number | undefined>, key: string): SearchValue {
  const rawKey = Object.keys(metadata).find(candidate => normalizeQueryText(candidate) === key)
  const value = rawKey === undefined ? undefined : metadata[rawKey]
  return value === '' || (typeof value === 'number' && !Number.isFinite(value)) ? undefined : value
}

/** Browser MIME data wins; common extensions fill in only missing/generic MIME data. */
export function readFileType(file: { name: string; type: string }): string | undefined {
  const reported = normalizeQueryText(file.type.trim()).split(';')[0].trim()
  if (reported && reported !== 'application/octet-stream') return reported
  const dot = file.name.lastIndexOf('.')
  const extension = dot > 0 ? normalizeQueryText(file.name.slice(dot + 1)) : ''
  return Object.hasOwn(extensionTypes, extension) ? extensionTypes[extension] : undefined
}

function typeCategory(mime: string): string | undefined {
  const prefix = mime.split('/')[0]
  if (['image', 'video', 'audio'].includes(prefix)) return prefix
  if (prefix === 'text' || /^(application\/(pdf|rtf|msword|epub\+zip|vnd\.ms-|vnd\.openxmlformats-officedocument\.|vnd\.oasis\.opendocument\.))/.test(mime)) return 'document'
  if (/^application\/(zip|gzip|x-gzip|x-tar|x-7z-compressed|x-rar-compressed|vnd\.rar|x-bzip2|x-xz|x-compressed|x-zip-compressed)$/.test(mime)) return 'archive'
  return undefined
}

function compare(left: number, operator: Operator, right: number): boolean {
  switch (operator) {
    case ':': case '=': return left === right
    case '!=': return left !== right
    case '>': return left > right
    case '>=': return left >= right
    case '<': return left < right
    case '<=': return left <= right
  }
}

function parseNumber(value: Token, size = false): number {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([a-z]*)$/i.exec(value.text)
  if (!match || (!size && match[2]) || (match[2] && !Object.hasOwn(units, normalizeQueryText(match[2])))) {
    fail(size ? 'Use a file size such as 24MB, 24 MB, or 500KiB.' : 'Use a number for this comparison.', value.position)
  }
  const number = Number(match[1]) * (match[2] ? units[normalizeQueryText(match[2])] : 1)
  if (!Number.isFinite(number)) fail('Use a finite number for this comparison.', value.position)
  if (size && number < 0) fail('File size cannot be negative.', value.position)
  return number
}

/** Calendar literals represent complete UTC years, months, or days. */
function datePeriod(value: Token): { start: number; end: number } {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value.text)
  if (!match) fail('Use a date in YYYY, YYYY-MM, or YYYY-MM-DD format.', value.position)
  const year = Number(match[1])
  const month = match[2] === undefined ? 1 : Number(match[2])
  const day = match[3] === undefined ? 1 : Number(match[3])
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    fail('Use a valid calendar date in YYYY, YYYY-MM, or YYYY-MM-DD format.', value.position)
  }
  const start = date.getTime()
  if (match[3] !== undefined) date.setUTCDate(day + 1)
  else if (match[2] !== undefined) date.setUTCMonth(month)
  else date.setUTCFullYear(year + 1)
  return { start, end: date.getTime() }
}

function compileComparison<T>(field: string, operator: Operator, value: Token, readField: FileQueryOptions<T>['readField']): Predicate<T> {
  const read = readField(field)
  if (field === 'modified' || field === 'taken') {
    const { start, end } = datePeriod(value)
    return record => {
      const actual = read(record)
      if (typeof actual !== 'number') return false
      switch (operator) {
        case ':': case '=': return actual >= start && actual < end
        case '!=': return actual < start || actual >= end
        case '>': return actual >= end
        case '>=': return actual >= start
        case '<': return actual < start
        case '<=': return actual < end
      }
    }
  }
  if (numericFields.has(field)) {
    const expected = parseNumber(value, field === 'size')
    return record => { const actual = read(record); return typeof actual === 'number' && compare(actual, operator, expected) }
  }
  if (field === 'aspect') {
    if (['landscape', 'portrait', 'square'].includes(normalizeQueryText(value.text))) return compileComparison('orientation', operator, value, readField)
    const ratio = /^(\d+(?:\.\d+)?)[x:]((?:\d+(?:\.\d+)?))$/i.exec(value.text)
    const expected = ratio ? Number(ratio[1]) / Number(ratio[2]) : parseNumber(value)
    if (!Number.isFinite(expected) || expected <= 0) fail('Use landscape, portrait, square, or a positive aspect ratio such as 16:9.', value.position)
    return record => { const actual = read(record); return typeof actual === 'number' && compare(actual, operator, expected) }
  }
  if (field.startsWith('metadata.') && ['>', '>=', '<', '<='].includes(operator)) {
    const expected = parseNumber(value)
    return record => {
      const raw = read(record)
      const actual = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
      return typeof actual === 'number' && Number.isFinite(actual) && compare(actual, operator, expected)
    }
  }
  if (![':', '=', '!='].includes(operator)) fail(`Use : (contains), = (exact), or != with ${field}.`, value.position)
  let expected = normalizeQueryText(value.text)
  if (field === 'ext') expected = expected.replace(/^\./, '')
  if (field === 'type') {
    if (expected.endsWith('s') && categories.has(expected.slice(0, -1))) expected = expected.slice(0, -1)
    if (!categories.has(expected) && !/^[\w.+-]+\/[\w.+-]+$/.test(expected)) {
      fail('Use image, video, audio, document, archive, or a MIME type such as image/jpeg.', value.position)
    }
  }
  if (field === 'orientation' && !['landscape', 'portrait', 'square'].includes(expected)) fail('Use landscape, portrait, or square.', value.position)
  const exact = operator !== ':' || ['type', 'ext', 'orientation', 'status'].includes(field)
  return record => {
    const raw = read(record)
    if (raw === undefined) return false
    const actual = normalizeQueryText(String(raw))
    const matches = field === 'type' && categories.has(expected) ? typeCategory(actual) === expected
      : exact ? actual === expected : actual.includes(expected)
    return operator === '!=' ? !matches : matches
  }
}

class Parser<T> {
  private index = 0
  private depth = 0
  constructor(private readonly tokens: Token[], private readonly options: FileQueryOptions<T>) {}
  private current() { return this.tokens[this.index] }
  private take() { return this.tokens[this.index++] }
  private keyword(word: string) { return this.current().kind === 'word' && this.current().text === word }

  parse(): Predicate<T> {
    if (this.current().kind === 'end') {
      if (!this.options.searchText) fail('Add a metadata condition, for example orientation:landscape.', this.current().position)
      return () => true
    }
    const predicate = this.or()
    if (this.current().kind !== 'end') fail(`Unexpected “${this.current().text}”. Add AND or OR between groups.`, this.current().position)
    return predicate
  }

  private or(): Predicate<T> {
    const alternatives = [this.and()]
    while (this.keyword('OR')) { this.take(); alternatives.push(this.and()) }
    return alternatives.length === 1 ? alternatives[0] : record => alternatives.some(predicate => predicate(record))
  }

  private and(): Predicate<T> {
    const requirements = [this.unary()]
    while (this.current().kind !== 'end' && this.current().kind !== 'right' && !this.keyword('OR')) {
      if (this.keyword('AND')) this.take()
      requirements.push(this.unary())
    }
    return requirements.length === 1 ? requirements[0] : record => requirements.every(predicate => predicate(record))
  }

  private unary(): Predicate<T> {
    if (++this.depth > 64) fail('Use fewer than 64 nested groups or exclusions.', this.current().position)
    try {
      if (this.keyword('NOT') || this.current().kind === 'minus') {
        this.take()
        const predicate = this.unary()
        return record => !predicate(record)
      }
      if (this.current().kind === 'left') {
        const opening = this.take()
        const predicate = this.or()
        if (this.current().kind !== 'right') fail('Close this group with ).', opening.position)
        this.take()
        return predicate
      }
      return this.term()
    } finally { this.depth-- }
  }

  private value(field: string): Token {
    let negative: Token | undefined
    if (this.current().kind === 'minus') negative = this.take()
    const token = this.take()
    if (!['word', 'string'].includes(token.kind) || (token.kind === 'word' && ['AND', 'OR', 'NOT'].includes(token.text))) {
      fail('Add a value after the field operator. Quote values containing spaces.', token.position)
    }
    const value = { ...token, text: `${negative ? '-' : ''}${token.text}`, position: negative?.position ?? token.position }
    if (field === 'aspect' && this.current().text === ':' && this.current().position === token.end) {
      this.take()
      const denominator = this.take()
      if (denominator.kind !== 'word') fail('Complete the aspect ratio, for example 16:9.', denominator.position)
      value.text += `:${denominator.text}`
      value.end = denominator.end
    }
    if (field === 'size' && this.current().kind === 'word' && Object.hasOwn(units, normalizeQueryText(this.current().text))) {
      value.text += ` ${this.take().text}`
    }
    return value
  }

  private field(token: Token): string {
    const field = canonicalField(token)
    if (this.options.allowField && !this.options.allowField(field)) {
      fail(`The ${field} field is only available in file search. Conditions use original file metadata.`, token.position)
    }
    return field
  }

  private term(): Predicate<T> {
    const token = this.take()
    if (!['word', 'string'].includes(token.kind) || (token.kind === 'word' && ['AND', 'OR', 'NOT'].includes(token.text))) {
      fail('Expected a search term, a filter, or a group in parentheses.', token.position)
    }
    if (this.current().kind === 'operator') {
      if (token.kind !== 'word') fail('Use an unquoted field name before the operator.', token.position)
      let operator = this.take().text as Operator
      // Both size<24MB and size:<24MB are accepted.
      if (operator === ':' && this.current().kind === 'operator' && this.current().text !== ':') operator = this.take().text as Operator
      if (normalizeQueryText(token.text) === 'has') {
        if (operator !== ':') fail('Use has:field to find files with that metadata.', token.position)
        const value = this.value('has')
        const read = this.options.readField(this.field(value))
        return record => { const actual = read(record); return actual !== undefined && actual !== '' }
      }
      const field = this.field(token)
      const value = this.value(field)
      return compileComparison(field, operator, value, this.options.readField)
    }
    const query = normalizeQueryText(token.text)
    if (!query) fail('Enter some text between the quotes.', token.position)
    if (!this.options.searchText) fail('Use an explicit metadata filter, for example name:holiday or orientation:landscape.', token.position)
    return this.options.searchText(query)
  }
}

/** Compile once per query. Invalid filters return no matches and a displayable error. */
export function compileFileQuery<T>(query: string, options: FileQueryOptions<T>): CompiledFileQuery<T> {
  try {
    if (query.length > 16_384) fail('Keep the search under 16,384 characters.', 16_384)
    return { matches: new Parser(tokenize(query), options).parse() }
  } catch (error) {
    if (!(error instanceof SearchSyntaxError)) throw error
    return { matches: () => false, error: { message: error.message, position: error.position } }
  }
}

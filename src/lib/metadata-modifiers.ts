export interface ModifierDefinition {
  key: string
  label: string
  description: string
  /** An editable modifier expression, without its leading pipe. */
  example: string
}

export const MODIFIER_DEFINITIONS: ModifierDefinition[] = [
  { key: 'lower', label: 'Lowercase', description: 'Convert text to lowercase.', example: 'lower' },
  { key: 'upper', label: 'Uppercase', description: 'Convert text to uppercase.', example: 'upper' },
  { key: 'title', label: 'Title case', description: 'Capitalize words separated by spaces, dots, dashes, or underscores.', example: 'title' },
  { key: 'trim', label: 'Trim', description: 'Remove whitespace from both ends.', example: 'trim' },
  { key: 'slug', label: 'Slug', description: 'Lowercase words, remove accents, and separate words with dashes.', example: 'slug' },
  { key: 'ascii', label: 'ASCII text', description: 'Remove accents and characters outside the ASCII range.', example: 'ascii' },
  { key: 'replace', label: 'Replace text', description: 'Replace every literal occurrence of the first string with the second.', example: 'replace(" ","-")' },
  { key: 'whitespace', label: 'Replace whitespace', description: 'Replace each run of spaces, tabs, or line breaks.', example: 'whitespace("-")' },
  { key: 'prefix', label: 'Add prefix', description: 'Add text before the value.', example: 'prefix("photo-")' },
  { key: 'suffix', label: 'Add suffix', description: 'Add text after the value.', example: 'suffix("-edited")' },
  { key: 'truncate', label: 'Limit length', description: 'Keep at most this many Unicode characters (0–4096).', example: 'truncate(40)' },
  { key: 'pad', label: 'Pad with zeros', description: 'Pad a value to this length (1–128).', example: 'pad(3)' },
  { key: 'bytes', label: 'Readable file size', description: 'Format bytes using decimal units, for example 2.4 MB.', example: 'bytes' },
  { key: 'compact', label: 'Compact number', description: 'Shorten large numbers, for example 68k or 2.4M.', example: 'compact' },
  { key: 'round', label: 'Round number', description: 'Round to at most this many decimal places (0–12).', example: 'round(2)' },
  { key: 'mime', label: 'Short MIME type', description: 'Keep the MIME subtype without an x- prefix or + suffix: image/svg+xml becomes svg.', example: 'mime' },
  { key: 'default', label: 'Fallback value', description: 'Use this text when metadata is unavailable or empty.', example: 'default("unknown")' },
  { key: 'date', label: 'Format date', description: 'Format a date in UTC with YYYY, MM, DD, HH, mm, and ss.', example: 'date("YYYY-MM-DD")' },
]

export type MetadataValue = string | number | Date | undefined

/** Only unavailable metadata can be recovered with default(...). */
export class MetadataUnavailableError extends Error {}

type Argument = string | number
interface Modifier { key: string; args: Argument[] }
const MAX_VALUE_LENGTH = 65_536
const MAX_ARGUMENT_LENGTH = 4096
const NO_ARGUMENTS = new Set(['lower', 'upper', 'title', 'trim', 'slug', 'ascii', 'bytes', 'compact', 'mime'])
const STRING_ARGUMENTS = new Set(['replace', 'whitespace', 'prefix', 'suffix', 'default', 'date'])

function modifierError(key: string, message: string): Error {
  return new Error(`The ${key || 'metadata'} modifier ${message}`)
}

function parseArguments(source: string, key: string): Argument[] {
  const args: Argument[] = []
  let cursor = 0
  const skipSpace = () => { while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor++ }
  skipSpace()
  while (cursor < source.length) {
    const quote = source[cursor]
    if (quote === '"' || quote === "'") {
      cursor++
      let value = ''
      let closed = false
      while (cursor < source.length) {
        const char = source[cursor++]
        if (char === quote) { closed = true; break }
        if (char !== '\\') { value += char; continue }
        const escape = source[cursor++]
        const escapes: Record<string, string> = { '\\': '\\', '"': '"', "'": "'", n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '/': '/' }
        if (escape === 'u') {
          const hex = source.slice(cursor, cursor + 4)
          if (!/^[\da-f]{4}$/i.test(hex)) throw modifierError(key, 'has an invalid Unicode escape. Use \\u followed by four hexadecimal digits.')
          value += String.fromCharCode(parseInt(hex, 16))
          cursor += 4
        } else if (Object.hasOwn(escapes, escape)) value += escapes[escape]
        else throw modifierError(key, 'has an invalid escape in a quoted argument.')
      }
      if (!closed) throw modifierError(key, 'has an unclosed quoted argument.')
      if (value.length > MAX_ARGUMENT_LENGTH) throw modifierError(key, `arguments cannot exceed ${MAX_ARGUMENT_LENGTH} characters.`)
      args.push(value)
    } else {
      const match = source.slice(cursor).match(/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i)
      if (!match) throw modifierError(key, 'arguments must be quoted text or numbers.')
      const value = Number(match[0])
      if (!Number.isFinite(value)) throw modifierError(key, 'requires a finite number.')
      args.push(value)
      cursor += match[0].length
    }
    skipSpace()
    if (cursor === source.length) break
    if (source[cursor++] !== ',') throw modifierError(key, 'arguments must be separated by commas.')
    skipSpace()
    if (cursor === source.length) throw modifierError(key, 'has an empty argument.')
    if (args.length >= 2) throw modifierError(key, 'accepts at most two arguments.')
  }
  return args
}

/** Validate the entire chain before reading values, including unavailable ones. */
function parseModifier(expression: string): Modifier {
  if (expression.length > 12_000) throw new Error('A modifier expression cannot exceed 12000 characters.')
  const match = expression.trim().match(/^([a-zA-Z][\w-]*)(?:\s*\(([\s\S]*)\))?$/)
  if (!match) throw new Error(`Invalid modifier “${expression.slice(0, 60)}”. Use a name or a function such as replace(" ","-").`)
  const key = match[1]
  if (!MODIFIER_DEFINITIONS.some(definition => definition.key === key)) throw new Error(`Unknown modifier “${key}”. Choose a modifier from the metadata menu.`)
  const args = match[2] === undefined ? [] : parseArguments(match[2], key)
  const expectedCount = NO_ARGUMENTS.has(key) ? 0 : key === 'replace' ? 2 : 1
  if (args.length !== expectedCount) throw modifierError(key, `requires ${expectedCount} argument${expectedCount === 1 ? '' : 's'}.`)
  if (STRING_ARGUMENTS.has(key) && args.some(value => typeof value !== 'string')) throw modifierError(key, 'requires quoted text arguments.')
  if (key === 'replace' && args[0] === '') throw modifierError(key, 'search text cannot be empty.')
  if (['truncate', 'pad', 'round'].includes(key)) {
    const limit = key === 'truncate' ? 4096 : key === 'pad' ? 128 : 12
    const minimum = key === 'pad' ? 1 : 0
    if (typeof args[0] !== 'number' || !Number.isInteger(args[0]) || args[0] < minimum || args[0] > limit) {
      throw modifierError(key, `requires a whole number from ${minimum} to ${limit}.`)
    }
  }
  if (key === 'date') validateDateFormat(args[0] as string)
  return { key, args }
}

function parseModifiers(expressions: string[]): Modifier[] {
  if (expressions.length > 32) throw new Error('A metadata token can use at most 32 modifiers.')
  return expressions.map(parseModifier)
}

/** Validate an editor's modifier chain without requiring a sample file. */
export function validateMetadataModifiers(expressions: string[]): void {
  parseModifiers(expressions)
}

export function validateDateFormat(pattern: string, label = 'date'): void {
  if (!pattern || /[a-zA-Z]/.test(pattern.replace(/YYYY|MM|DD|HH|mm|ss/g, ''))) {
    throw new Error(`Use YYYY, MM, DD, HH, mm, or ss in ${label.toLowerCase()} formats.`)
  }
}

export function formatUtcDate(date: Date, pattern = 'YYYY-MM-DD'): string {
  validateDateFormat(pattern)
  if (Number.isNaN(date.getTime())) throw new MetadataUnavailableError('Invalid date metadata.')
  const parts: Record<string, string> = {
    YYYY: date.getUTCFullYear().toString().padStart(4, '0'),
    MM: (date.getUTCMonth() + 1).toString().padStart(2, '0'),
    DD: date.getUTCDate().toString().padStart(2, '0'),
    HH: date.getUTCHours().toString().padStart(2, '0'),
    mm: date.getUTCMinutes().toString().padStart(2, '0'),
    ss: date.getUTCSeconds().toString().padStart(2, '0'),
  }
  return pattern.replace(/YYYY|MM|DD|HH|mm|ss/g, part => parts[part])
}

function stringValue(value: Exclude<MetadataValue, undefined>): string {
  return value instanceof Date ? formatUtcDate(value) : String(value)
}

function bounded(value: string): string {
  if (value.length > MAX_VALUE_LENGTH) throw new Error(`Modifier output cannot exceed ${MAX_VALUE_LENGTH} characters.`)
  return value
}

function numericValue(value: string, key: string): number {
  const number = Number(value)
  if (!value.trim() || !Number.isFinite(number)) throw modifierError(key, 'requires a finite numeric value.')
  return number
}

function removeAccents(value: string): string {
  const substitutions: Record<string, string> = { ß: 'ss', Æ: 'AE', æ: 'ae', Œ: 'OE', œ: 'oe', Ø: 'O', ø: 'o', Ł: 'L', ł: 'l', Đ: 'D', đ: 'd', Þ: 'Th', þ: 'th' }
  return value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[ßÆæŒœØøŁłĐđÞþ]/g, char => substitutions[char])
}

function scaledNumber(number: number, units: string[], separator: string): string {
  let exponent = Math.min(Math.max(0, Math.floor(Math.log10(Math.abs(number) || 1) / 3)), units.length - 1)
  let value = number / 1000 ** exponent
  if (Math.abs(Number(value.toFixed(1))) >= 1000 && exponent < units.length - 1) {
    exponent++
    value = number / 1000 ** exponent
  }
  return `${Number(value.toFixed(exponent === 0 && separator ? 0 : 1))}${separator}${units[exponent]}`
}

export function formatReadableBytes(bytes: number): string {
  return scaledNumber(bytes, ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'], ' ')
}

/** Apply modifiers in order. A Date retains its timestamp until converted to text. */
export function applyMetadataModifiers(
  value: MetadataValue,
  expressions: string[] = [],
  unavailableError?: Error,
): string {
  const modifiers = parseModifiers(expressions)
  for (const { key, args } of modifiers) {
    if (key === 'default') {
      if (value === undefined || value === '') value = args[0]
      continue
    }
    if (value === undefined) continue
    if (key === 'date') {
      const date = value instanceof Date ? value : new Date(value)
      if (Number.isNaN(date.getTime())) throw modifierError(key, 'requires a valid date value.')
      value = bounded(formatUtcDate(date, args[0] as string))
      continue
    }
    const text = bounded(stringValue(value))
    const arg = args[0] as string
    switch (key) {
      case 'lower': value = text.toLowerCase(); break
      case 'upper': value = text.toUpperCase(); break
      case 'title': value = text.toLowerCase().replace(/(^|[\s._-])(\p{L})/gu, (_, separator: string, letter: string) => separator + letter.toUpperCase()); break
      case 'trim': value = text.trim(); break
      case 'slug': value = removeAccents(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, ''); break
      case 'ascii': value = removeAccents(text).replace(/[^\x00-\x7f]/g, ''); break
      case 'replace': {
        const replacement = args[1] as string
        // Check the prospective length before allocating an expanded string.
        const occurrences = text.split(arg)
        if (text.length + (occurrences.length - 1) * (replacement.length - arg.length) > MAX_VALUE_LENGTH) {
          throw new Error(`Modifier output cannot exceed ${MAX_VALUE_LENGTH} characters.`)
        }
        value = occurrences.join(replacement)
        break
      }
      case 'whitespace': {
        let length = text.length
        for (const match of text.matchAll(/\s+/g)) length += arg.length - match[0].length
        if (length > MAX_VALUE_LENGTH) throw new Error(`Modifier output cannot exceed ${MAX_VALUE_LENGTH} characters.`)
        value = text.replace(/\s+/g, () => arg)
        break
      }
      case 'prefix': value = arg + text; break
      case 'suffix': value = text + arg; break
      case 'truncate': value = Array.from(text).slice(0, args[0] as number).join(''); break
      case 'pad': value = /^-\d/.test(text) ? '-' + text.slice(1).padStart((args[0] as number) - 1, '0') : text.padStart(args[0] as number, '0'); break
      case 'bytes': {
        const number = numericValue(text, key)
        if (number < 0) throw modifierError(key, 'requires a nonnegative byte count.')
        value = formatReadableBytes(number)
        break
      }
      case 'compact': value = scaledNumber(numericValue(text, key), ['', 'k', 'M', 'B', 'T', 'P', 'E'], ''); break
      case 'round': value = String(Number(numericValue(text, key).toFixed(args[0] as number))); break
      case 'mime': {
        const match = text.trim().match(/^[^/\s]+\/([^/;\s]+)(?:\s*;.*)?$/)
        if (!match) throw modifierError(key, 'requires a MIME type such as image/jpeg.')
        value = match[1].split('+')[0].replace(/^x-/, '')
        break
      }
    }
    value = bounded(stringValue(value))
  }
  if (value === undefined) throw unavailableError ?? new MetadataUnavailableError('Missing metadata.')
  return bounded(stringValue(value))
}

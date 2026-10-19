import { describe, expect, it } from 'vitest'
import { applyMetadataModifiers, MODIFIER_DEFINITIONS, validateMetadataModifiers } from './metadata-modifiers'

describe('metadata modifiers', () => {
  it('validates editor expressions without a sample value', () => {
    expect(() => validateMetadataModifiers(['trim', 'replace(" ","-")', 'pad(3)'])).not.toThrow()
    expect(() => validateMetadataModifiers(['round(13)'])).toThrow('whole number from 0 to 12')
    expect(() => validateMetadataModifiers(['prefix(unquoted)'])).toThrow('quoted text or numbers')
    expect(() => validateMetadataModifiers(['unknown'])).toThrow('Unknown modifier')
    expect(() => validateMetadataModifiers(Array.from({ length: 33 }, () => 'trim'))).toThrow('at most 32')
  })

  it('applies string transformations from left to right', () => {
    expect(applyMetadataModifiers('  Crème BRÛLÉE  ', ['trim', 'ascii', 'lower', 'replace(" ","-")', 'prefix("dessert-")', 'suffix("-01")']))
      .toBe('dessert-creme-brulee-01')
    expect(applyMetadataModifiers('my GREAT_photo-title', ['title'])).toBe('My Great_Photo-Title')
    expect(applyMetadataModifiers('Straße Æsir & Œuvre', ['ascii', 'upper'])).toBe('STRASSE AESIR & OEUVRE')
    expect(applyMetadataModifiers('  Café / 東京 & a_b! ', ['slug'])).toBe('cafe-東京-a-b')
    expect(applyMetadataModifiers('one \t\n two', ['whitespace("-")'])).toBe('one-two')
  })

  it('replaces literal strings and keeps replacement dollar sequences literal', () => {
    expect(applyMetadataModifiers('a.b.a', ['replace(".","$&")'])).toBe('a$&b$&a')
    expect(applyMetadataModifiers('A|B,{x}', ['replace("|",",")', 'replace("{x}","$1")'])).toBe('A,B,$1')
    expect(applyMetadataModifiers('one two', ["replace(' ','-')"])).toBe('one-two')
  })

  it('supports quoted text with escaped quotes, backslashes, and Unicode', () => {
    expect(applyMetadataModifiers('a"b\\c', [String.raw`replace("\"","'")`, String.raw`replace('\\','-')`])).toBe("a'b-c")
    expect(applyMetadataModifiers('file', [String.raw`prefix("\u00e9\t")`])).toBe('é\tfile')
  })

  it('formats decimal bytes and compact numbers, including rounded unit boundaries', () => {
    expect(applyMetadataModifiers(2_400_000, ['bytes'])).toBe('2.4 MB')
    expect(applyMetadataModifiers(0, ['bytes'])).toBe('0 B')
    expect(applyMetadataModifiers(999_999, ['bytes'])).toBe('1 MB')
    expect(applyMetadataModifiers(68_000, ['compact'])).toBe('68k')
    expect(applyMetadataModifiers(999_999, ['compact'])).toBe('1M')
    expect(applyMetadataModifiers(-68_000, ['compact'])).toBe('-68k')
    expect(applyMetadataModifiers(25.9584, ['round(2)'])).toBe('25.96')
    expect(applyMetadataModifiers(25.5, ['round(0)'])).toBe('26')
    expect(applyMetadataModifiers(7, ['pad(3)'])).toBe('007')
    expect(applyMetadataModifiers(-7, ['pad(3)'])).toBe('-07')
  })

  it('shortens MIME subtypes and truncates without breaking surrogate pairs', () => {
    expect(applyMetadataModifiers('image/jpeg', ['mime'])).toBe('jpeg')
    expect(applyMetadataModifiers('image/svg+xml', ['mime'])).toBe('svg')
    expect(applyMetadataModifiers('application/x-tar; charset=utf-8', ['mime'])).toBe('tar')
    expect(applyMetadataModifiers('a😀bc', ['truncate(2)'])).toBe('a😀')
    expect(applyMetadataModifiers('abc', ['truncate(0)', 'default("empty")'])).toBe('empty')
  })

  it('formats dates in UTC and preserves timestamps until converted to text', () => {
    const date = new Date('2025-04-12T16:05:09+02:00')
    expect(applyMetadataModifiers(date)).toBe('2025-04-12')
    expect(applyMetadataModifiers(date, ['date("HH-mm-ss")'])).toBe('14-05-09')
    expect(applyMetadataModifiers(date, ['date("YYYY-MM-DD HH-mm-ss")', 'whitespace("_")'])).toBe('2025-04-12_14-05-09')
    expect(applyMetadataModifiers('2025-04-12T16:05:09+02:00', ['date("HH-mm")'])).toBe('14-05')
  })

  it('lets defaults recover unavailable or empty metadata without changing zero', () => {
    expect(applyMetadataModifiers(undefined, ['trim', 'default(" Unknown ")', 'trim', 'upper'])).toBe('UNKNOWN')
    expect(applyMetadataModifiers('  ', ['trim', 'default("unknown")'])).toBe('unknown')
    expect(applyMetadataModifiers(0, ['default("unknown")'])).toBe('0')
    expect(() => applyMetadataModifiers(undefined, [], new Error('Missing camera metadata.'))).toThrow('Missing camera metadata.')
  })

  it.each([
    ['wat', 'Unknown modifier'], ['replace("", "x")', 'cannot be empty'],
    ['replace("x")', 'requires 2 arguments'], ['trim("x")', 'requires 0 arguments'],
    ['prefix(2)', 'quoted text'], ['prefix(x)', 'quoted text or numbers'],
    ['prefix("x",)', 'empty argument'], [String.raw`prefix("\q")`, 'invalid escape'],
    ['pad(0)', 'whole number from 1 to 128'], ['pad(129)', 'whole number from 1 to 128'],
    ['round(13)', 'whole number from 0 to 12'], ['round(1.5)', 'whole number'],
    ['truncate(-1)', 'whole number from 0 to 4096'], ['truncate(4097)', 'whole number'],
    ['round(1e999)', 'finite number'], ['date("invalid")', 'Use YYYY'],
  ])('validates %s even when a default could recover missing data', (expression, message) => {
    expect(() => applyMetadataModifiers(undefined, ['default("fallback")', expression])).toThrow(message)
    expect(() => applyMetadataModifiers(undefined, [expression, 'default("fallback")'])).toThrow(message)
  })

  it('rejects invalid transformed values and bounds chain growth', () => {
    expect(() => applyMetadataModifiers('words', ['round(2)'])).toThrow('finite numeric value')
    expect(() => applyMetadataModifiers(-1, ['bytes'])).toThrow('nonnegative')
    expect(() => applyMetadataModifiers('jpeg', ['mime'])).toThrow('MIME type')
    expect(() => applyMetadataModifiers('invalid', ['date("YYYY")'])).toThrow('valid date')
    expect(() => applyMetadataModifiers('', Array.from({ length: 33 }, () => 'trim'))).toThrow('at most 32')
    expect(() => applyMetadataModifiers('a'.repeat(100), [`replace("a","${'a'.repeat(4096)}")`])).toThrow('cannot exceed 65536')
    expect(() => applyMetadataModifiers('a '.repeat(100), [`whitespace("${'a'.repeat(4096)}")`])).toThrow('cannot exceed 65536')
  })

  it('publishes unique keys and valid editable expressions for the complete catalog', () => {
    expect(new Set(MODIFIER_DEFINITIONS.map(modifier => modifier.key)).size).toBe(MODIFIER_DEFINITIONS.length)
    for (const modifier of MODIFIER_DEFINITIONS) {
      // An unavailable value skips transformation while still validating all arguments.
      expect(applyMetadataModifiers(undefined, [modifier.example, 'default("valid")'])).toBe(modifier.key === 'default' ? 'unknown' : 'valid')
    }
  })
})

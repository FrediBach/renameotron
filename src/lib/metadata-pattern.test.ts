import { describe, expect, it } from 'vitest'
import { scanMetadataTokens } from './metadata-pattern'

describe('metadata expression scanner', () => {
  it('keeps legacy formats and ordered modifier expressions with UTF-16 offsets', () => {
    const input = '😀{index:3|suffix("x")}-{modified:YYYY-MM-DD|lower}'
    expect(scanMetadataTokens(input)).toEqual([
      { start: 2, end: 23, key: 'index', format: '3', modifiers: ['suffix("x")'], complete: true },
      { start: 24, end: input.length, key: 'modified', format: 'YYYY-MM-DD', modifiers: ['lower'], complete: true },
    ])
  })

  it('only splits pipes outside parentheses and quoted arguments', () => {
    const input = '{name|trim|replace(" | {ext},:","$1-$&")|suffix(\'a|b\')}'
    expect(scanMetadataTokens(input)).toEqual([{
      start: 0, end: input.length, key: 'name',
      modifiers: ['trim', 'replace(" | {ext},:","$1-$&")', "suffix('a|b')"], complete: true,
    }])
  })

  it('respects escaped quotes and backslashes without decoding arguments', () => {
    const input = String.raw`{name|replace("a\"|{ext}","x\\")|lower}`
    expect(scanMetadataTokens(input)[0]).toEqual({
      start: 0, end: input.length, key: 'name',
      modifiers: [String.raw`replace("a\"|{ext}","x\\")`, 'lower'], complete: true,
    })
  })

  it('keeps incomplete expressions available to the editor without scanning literal braces', () => {
    const input = '{name|replace("{ext}|$1'
    expect(scanMetadataTokens(input)).toEqual([])
    expect(scanMetadataTokens(input, true)).toEqual([{
      start: 0, end: input.length, key: 'name', modifiers: ['replace("{ext}|$1'], complete: false,
      error: 'Close the quoted argument in the metadata modifier.',
    }])
    expect(scanMetadataTokens('photo-{', true)).toEqual([{ start: 6, end: 7, key: '', modifiers: [], complete: false }])
    expect(scanMetadataTokens('photo-{mod', true)).toEqual([{ start: 6, end: 10, key: 'mod', modifiers: [], complete: false }])
  })

  it('reports structural errors and consumes the entire malformed expression', () => {
    for (const input of ['{name|}', '{name||lower}', '{name|lower)}', '{name|replace("a","b"}', '{name|replace({ext},"jpg")}']) {
      const tokens = scanMetadataTokens(input)
      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toMatchObject({ start: 0, end: input.length, key: 'name', complete: true })
      expect(tokens[0].error).toBeTruthy()
    }
  })

  it('preserves ordinary braces and existing nested-token behavior outside modifiers', () => {
    expect(scanMetadataTokens('a {not a token} {123} {name')).toEqual([])
    expect(scanMetadataTokens('{{name}}')).toEqual([{ start: 1, end: 7, key: 'name', modifiers: [], complete: true }])
    expect(scanMetadataTokens('{literal:{ext}}')).toEqual([{ start: 9, end: 14, key: 'ext', modifiers: [], complete: true }])
  })
})

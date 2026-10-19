import { describe, expect, it } from 'vitest'
import { createShareUrl, readSharedSetup } from './share'

describe('shared pattern setups', () => {
  it('preserves Unicode, regex escapes, captures, modifiers, and URL delimiters', () => {
    const setup = {
      pattern: '^(旅行|été)\\s+([\\d]+)\\.(jpg|png)$',
      replacement: 'photos/$1-{name|replace("+ & # ? %", "📷")}.{ext|lower}',
      flags: 'gi',
      recursive: true,
    }
    const url = new URL(createShareUrl('https://renameotron.com/tools/?old=value#old', setup))
    expect(url.origin + url.pathname).toBe('https://renameotron.com/tools/')
    expect(url.search).toBe('')
    expect(readSharedSetup(url.hash)).toEqual(setup)
  })

  it.each(['', 'g', 'i', 'gi'])('preserves empty fields and flags %j', flags => {
    const setup = { pattern: '', replacement: '', flags, recursive: false }
    expect(readSharedSetup(new URL(createShareUrl('https://renameotron.com/', setup)).hash)).toEqual(setup)
  })

  it.each([
    '', '#help', '#%',
    '#v=2&pattern=foo&replacement=bar&flags=i&recursive=0',
    '#v=1&replacement=bar&flags=i&recursive=0',
    '#v=1&pattern=foo&flags=i&recursive=0',
    '#v=1&pattern=foo&replacement=bar&recursive=0',
    '#v=1&pattern=foo&replacement=bar&flags=i',
    '#v=1&pattern=foo&replacement=bar&flags=invalid&recursive=0',
    '#v=1&pattern=foo&replacement=bar&flags=ii&recursive=0',
    '#v=1&pattern=foo&replacement=bar&flags=i&recursive=false',
  ])('ignores incomplete or unsupported links: %s', hash => {
    expect(readSharedSetup(hash)).toBeNull()
  })
})

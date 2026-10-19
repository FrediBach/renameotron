import { describe, expect, it } from 'vitest'
import { getTemplateModifiers, matchesTemplateSearch } from './template-search'
import type { RenameTemplate } from './templates'

const template: RenameTemplate = {
  id: 'resume-series',
  name: 'Résumé series',
  description: 'Archive-ready revisions for your clients.',
  category: 'Documents',
  pattern: '^.+\\.pdf$',
  replacement: '{name|trim|ascii}-{index|pad(4)}.{ext|lower}',
  flags: 'i',
  keywords: ['client handover', 'bookkeeping'],
}

describe('template search', () => {
  it('ignores case, accents, and extra whitespace while requiring every search term', () => {
    expect(matchesTemplateSearch(template, '  RESUME  \t archive\nPAD ')).toBe(true)
    expect(matchesTemplateSearch(template, 'résumé')).toBe(true)
    expect(matchesTemplateSearch(template, 'resume missingword')).toBe(false)
    expect(matchesTemplateSearch(template, ' \n\t ')).toBe(true)
  })

  it('searches categories, keywords, and literal find and replacement patterns', () => {
    for (const query of ['documents', 'handover bookkeeping', '^.+\\.PDF$', '{index|pad(4)}']) {
      expect(matchesTemplateSearch(template, query), query).toBe(true)
    }
  })

  it('finds used modifiers by their names, labels, and descriptions', () => {
    expect(matchesTemplateSearch(template, 'ascii')).toBe(true)
    expect(matchesTemplateSearch(template, 'pad with zeros')).toBe(true)
    expect(matchesTemplateSearch(template, 'remove accents')).toBe(true)
    expect(matchesTemplateSearch(template, 'fallback value')).toBe(false)
  })

  it('finds metadata by its friendly label and description', () => {
    const photo: RenameTemplate = { ...template, name: 'My photos', description: '', keywords: [], category: 'Photos', replacement: '{taken:YYYY-MM-DD}.{ext}' }
    expect(matchesTemplateSearch(photo, 'capture date')).toBe(true)
    expect(matchesTemplateSearch(photo, 'embedded metadata')).toBe(true)
    expect(matchesTemplateSearch(photo, 'camera model')).toBe(false)
  })

  it('keeps older saved templates without keywords searchable', () => {
    const saved: RenameTemplate = { id: 'saved', name: 'Personal rule', description: 'An older naming rule.', category: 'Saved', pattern: 'old', replacement: 'new', flags: 'g' }
    expect(matchesTemplateSearch(saved, 'personal saved')).toBe(true)
    expect(matchesTemplateSearch(saved, 'new')).toBe(true)
    expect(matchesTemplateSearch(saved, 'missing')).toBe(false)
    expect(getTemplateModifiers(saved)).toEqual([])
  })
})

describe('template modifier discovery', () => {
  it('returns each used modifier once in definition order', () => {
    const result = getTemplateModifiers({ ...template, replacement: '{name|trim|ascii|lower}.{ext|lower}-{index|pad(3)}' })
    expect(result.map(modifier => modifier.key)).toEqual(['lower', 'trim', 'ascii', 'pad'])
    expect(result.find(modifier => modifier.key === 'pad')?.label).toBe('Pad with zeros')
  })

  it('ignores modifier-like text and nested token text inside quoted arguments', () => {
    const literal: RenameTemplate = { ...template, replacement: '{name|suffix("|slug|{size|bytes}")|upper|lower}.{ext|upper}' }
    expect(getTemplateModifiers(literal).map(modifier => modifier.key)).toEqual(['lower', 'upper', 'suffix'])
    expect(matchesTemplateSearch(literal, 'readable file size')).toBe(false)
  })
})

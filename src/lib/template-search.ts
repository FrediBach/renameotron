import { MODIFIER_DEFINITIONS } from './metadata-modifiers'
import { scanMetadataTokens } from './metadata-pattern'
import { TOKEN_DEFINITIONS } from './rename'
import type { RenameTemplate } from './templates'

export function getTemplateModifiers(template: RenameTemplate) {
  const keys = new Set(scanMetadataTokens(template.replacement).flatMap(token =>
    token.modifiers.map(modifier => modifier.trim().match(/^[\w-]+/)?.[0]),
  ))
  return MODIFIER_DEFINITIONS.filter(modifier => keys.has(modifier.key))
}

function normalizeSearch(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Match every search word, even when they occur in different template fields. */
export function matchesTemplateSearch(template: RenameTemplate, query: string): boolean {
  const terms = normalizeSearch(query).trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const tokenKeys = new Set(scanMetadataTokens(template.replacement).map(token => token.key))
  const metadata = TOKEN_DEFINITIONS.filter(token => tokenKeys.has(token.key))
  const modifiers = getTemplateModifiers(template)
  const keywords = Array.isArray(template.keywords) ? template.keywords.filter(word => typeof word === 'string') : []
  const text = normalizeSearch([
    template.name, template.description, template.category, template.pattern, template.replacement,
    ...keywords,
    ...metadata.flatMap(token => [token.key, token.label, token.description]),
    ...modifiers.flatMap(modifier => [modifier.key, modifier.label, modifier.description]),
  ].join(' '))
  return terms.every(term => text.includes(term))
}

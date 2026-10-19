export interface MetadataPatternToken {
  start: number
  end: number
  key: string
  format?: string
  /** Raw modifier expressions, in the order in which they are applied. */
  modifiers: string[]
  complete: boolean
  error?: string
}

/**
 * Find metadata expressions without interpreting their values or arguments.
 * Quoted modifier arguments may contain delimiters, braces, and escaped quotes.
 * Tolerant scanning also returns unfinished expressions for editor assistance.
 */
export function scanMetadataTokens(text: string, tolerant = false): MetadataPatternToken[] {
  const tokens: MetadataPatternToken[] = []
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') continue
    const key = text.slice(start + 1).match(/^[a-zA-Z][\w-]*/)?.[0]
    if (!key) {
      if (tolerant && start === text.length - 1) tokens.push({ start, end: text.length, key: '', modifiers: [], complete: false })
      continue
    }

    let cursor = start + key.length + 1
    while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor++
    if (cursor < text.length && !':|}'.includes(text[cursor])) continue

    let format: string | undefined
    if (text[cursor] === ':') {
      const formatStart = ++cursor
      while (cursor < text.length && !'{}|'.includes(text[cursor])) cursor++
      // Preserve the existing treatment of ordinary nested braces in text.
      if (text[cursor] === '{') continue
      format = text.slice(formatStart, cursor)
    }

    const modifiers: string[] = []
    let error: string | undefined
    const hasModifiers = text[cursor] === '|'
    if (hasModifiers) {
      let segmentStart = ++cursor
      let quote: string | undefined
      let escaped = false
      let depth = 0
      let braces = 0
      for (; cursor < text.length; cursor++) {
        const character = text[cursor]
        if (quote) {
          if (escaped) escaped = false
          else if (character === '\\') escaped = true
          else if (character === quote) quote = undefined
          continue
        }
        if (character === '"' || character === "'") quote = character
        else if (character === '(') depth++
        else if (character === ')') {
          if (depth) depth--
          else error ??= 'Unexpected closing parenthesis in metadata modifiers.'
        } else if (character === '{') {
          braces++
          error ??= 'Put literal braces in quoted modifier arguments.'
        } else if (character === '}') {
          if (braces) braces--
          else break
        } else if (character === '|' && depth === 0 && braces === 0) {
          modifiers.push(text.slice(segmentStart, cursor))
          segmentStart = cursor + 1
        }
      }
      modifiers.push(text.slice(segmentStart, cursor))
      if (quote) error ??= 'Close the quoted argument in the metadata modifier.'
      else if (depth) error ??= 'Close the parentheses in the metadata modifier.'
      else if (modifiers.some(modifier => !modifier.trim())) error ??= 'Add a modifier after each | separator.'
    }

    const complete = text[cursor] === '}'
    if (!complete && hasModifiers) error ??= 'Close the metadata modifier expression with }.'
    const end = complete ? cursor + 1 : cursor
    if (complete || tolerant) {
      tokens.push({ start, end, key, ...(format === undefined ? {} : { format }), modifiers, complete, ...(error ? { error } : {}) })
    }
    // Never scan quoted arguments again, even if an expression is unfinished.
    start = end - 1
  }
  return tokens
}

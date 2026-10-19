import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { TOKEN_DEFINITIONS } from '../lib/rename'
import { MODIFIER_DEFINITIONS } from '@/lib/metadata-modifiers'
import { scanMetadataTokens } from '@/lib/metadata-pattern'
import type { CaptureGroup } from '@/lib/highlight-types'
import { tokenizeRegex, tokenizeReplacement } from '@/lib/pattern-highlights'
import { HighlightedText } from './HighlightedText'
import './pattern-input.css'

export interface PatternInputProps {
  id: string
  value: string
  onChange: (value: string) => void
  kind: 'regex' | 'replacement'
  placeholder?: string
  invalid?: boolean
  captureGroups?: CaptureGroup[]
  inputRef?: RefObject<HTMLInputElement | null>
}

function tokenKey(key: string) {
  return key.replace(/^\{/, '').replace(/\}$/, '')
}

const EMPTY_CAPTURE_GROUPS: CaptureGroup[] = []

export function PatternInput({ id, value, onChange, kind, placeholder, invalid = false, captureGroups = EMPTY_CAPTURE_GROUPS, inputRef: externalInputRef }: PatternInputProps) {
  const highlights = useMemo(() => kind === 'regex' ? tokenizeRegex(value).spans : tokenizeReplacement(value, captureGroups), [value, kind, captureGroups])
  const localInputRef = useRef<HTMLInputElement>(null)
  const inputRef = externalInputRef ?? localInputRef
  const highlightRef = useRef<HTMLPreElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [cursor, setCursor] = useState(value.length)
  const [navigation, setNavigation] = useState<{ value: string; cursor: number; index: number } | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const completion = getCompletion(value, cursor, kind)
  const { suggestions, completingModifier } = completion
  const isOpen = focused && !dismissed && suggestions.length > 0
  const activeIndex = navigation?.value === value && navigation.cursor === cursor ? navigation.index : 0
  const setActiveIndex = (index: number) => setNavigation({ value, cursor, index })
  const selectedIndex = Math.min(activeIndex, Math.max(0, suggestions.length - 1))
  const menuId = `${id}-suggestions`

  const syncScroll = useCallback(() => {
    if (highlightRef.current && inputRef.current) {
      highlightRef.current.scrollLeft = inputRef.current.scrollLeft
    }
  }, [inputRef])

  useLayoutEffect(syncScroll, [value, syncScroll])
  useEffect(() => {
    if (!isOpen || !menuRef.current) return
    const option = menuRef.current.children[selectedIndex] as HTMLElement | undefined
    if (!option) return
    const menu = menuRef.current
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight
    }
    // Also reveal the active suggestion when the rule pane itself is scrolled.
    option.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [isOpen, selectedIndex])

  const insertToken = (key: string) => {
    const result = completeToken(value, cursor, key, completion)
    if (!result) return
    const { next, nextCursor } = result
    onChange(next)
    setCursor(nextCursor)
    setDismissed(true)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(nextCursor, nextCursor)
      syncScroll()
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((selectedIndex + delta + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      insertToken(suggestions[selectedIndex].example)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setDismissed(true)
    }
  }

  const autocompleteProps = kind === 'replacement' ? {
    role: 'combobox' as const,
    'aria-autocomplete': 'list' as const,
    'aria-expanded': isOpen,
  } : {}

  return (
    <div className={`pattern-input-wrap${invalid ? ' is-invalid' : ''}`}>
      <pre ref={highlightRef} className="pattern-highlight" aria-hidden="true">
        {value ? <HighlightedText text={value} spans={highlights} /> : <span className="pattern-placeholder">{placeholder}</span>}
        {'\u200b'}
      </pre>
      <input
        ref={inputRef}
        id={id}
        className="pattern-text-input"
        type="text"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        aria-invalid={invalid || undefined}
        {...autocompleteProps}
        aria-controls={isOpen ? menuId : undefined}
        aria-activedescendant={isOpen ? `${menuId}-${selectedIndex}` : undefined}
        onChange={(event) => {
          setNavigation(null)
          setCursor(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
          setDismissed(false)
          onChange(event.currentTarget.value)
        }}
        onFocus={(event) => {
          setNavigation(null)
          setFocused(true)
          setCursor(event.currentTarget.selectionStart ?? value.length)
          setDismissed(false)
        }}
        onBlur={() => setFocused(false)}
        onSelect={(event) => {
          const nextCursor = event.currentTarget.selectionStart ?? value.length
          if (nextCursor !== cursor) setNavigation(null)
          setCursor(nextCursor)
        }}
        onScroll={syncScroll}
        onKeyDown={handleKeyDown}
      />
      {isOpen && (
        <div ref={menuRef} className="autocomplete-menu" id={menuId} role="listbox" aria-label={completingModifier ? 'Metadata modifiers' : 'File metadata'}>
          {suggestions.map((token, index) => (
            <button
              key={token.key}
              id={`${menuId}-${index}`}
              className={`autocomplete-option${index === selectedIndex ? ' is-active' : ''}`}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => insertToken(token.example)}
            >
              <span className="autocomplete-option-heading">
                <code>{token.example}</code>
                <span>{token.label}</span>
              </span>
              <span className="autocomplete-option-description">{token.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function getCompletion(value: string, cursor: number, kind: PatternInputProps['kind']) {
  const precedingToken = kind === 'replacement' ? scanMetadataTokens(value.slice(0, cursor), true).at(-1) : undefined
  const activeToken = precedingToken && !precedingToken.complete && precedingToken.end === cursor ? precedingToken : undefined
  const completingModifier = !!activeToken?.modifiers.length
  const partialModifier = activeToken?.modifiers.at(-1)
  const query = completingModifier
    ? (partialModifier && !/^\s*[a-z]*$/i.test(partialModifier) ? undefined : partialModifier?.trim().toLowerCase())
    : activeToken ? value.slice(activeToken.start + 1, cursor).toLowerCase() : undefined
  const definitions = completingModifier ? MODIFIER_DEFINITIONS : TOKEN_DEFINITIONS
  const suggestions = query === undefined ? [] : definitions.filter((token) => (
    tokenKey(token.key).toLowerCase().includes(query)
    || tokenKey(token.example).toLowerCase().includes(query)
    || token.label.toLowerCase().includes(query)
  ))
  return { activeToken, completingModifier, partialModifier, suggestions }
}

function completeToken(value: string, cursor: number, key: string, { activeToken, completingModifier, partialModifier }: ReturnType<typeof getCompletion>) {
  if (!activeToken) return
  const wholeToken = scanMetadataTokens(value, true).find(token => token.start === activeToken.start) ?? activeToken
  let next: string
  let nextCursor: number
  if (completingModifier) {
    const start = cursor - (partialModifier?.length ?? 0)
    const segmentLength = wholeToken.modifiers[activeToken.modifiers.length - 1]?.length ?? partialModifier?.length ?? 0
    const end = start + segmentLength
    const closing = wholeToken.complete ? '' : '}'
    next = value.slice(0, start) + key + value.slice(end, wholeToken.end) + closing + value.slice(wholeToken.end)
    nextCursor = start + key.length
    if (next[nextCursor] === '}') nextCursor++
  } else {
    const token = tokenKey(key)
    const chain = wholeToken.modifiers.length ? `|${wholeToken.modifiers.join('|')}` : ''
    const expression = `{${token}${chain}}`
    // Empty braces are literal to the scanner, but their closing brace can
    // still be reused when the user completes a metadata key between them.
    const end = !wholeToken.complete && value[wholeToken.end] === '}' ? wholeToken.end + 1 : wholeToken.end
    next = value.slice(0, activeToken.start) + expression + value.slice(end)
    nextCursor = activeToken.start + expression.length
  }
  return { next, nextCursor }
}

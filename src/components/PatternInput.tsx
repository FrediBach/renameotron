import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { TOKEN_DEFINITIONS } from '../lib/rename'
import './pattern-input.css'

export interface PatternInputProps {
  id: string
  value: string
  onChange: (value: string) => void
  kind: 'regex' | 'replacement'
  placeholder?: string
  invalid?: boolean
}

function highlight(value: string, kind: PatternInputProps['kind']): ReactNode[] {
  const expression = kind === 'regex'
    ? /\\(?:[pP]\{[^}]*\}|u\{[\da-fA-F]*\}|.)|\(\?<[^>]+>|\(\?[=:!]|[()[\]{}]|[?+*^$|.]/g
    : /\$\$|\$[&`']|\$\d{1,2}|\$<[^>]+>|\{[^{}]*\}?/g
  const parts: ReactNode[] = []
  let end = 0

  for (const match of value.matchAll(expression)) {
    const start = match.index
    if (start > end) parts.push(value.slice(end, start))
    const token = match[0]
    const className = kind === 'replacement'
      ? token.startsWith('$') ? 'syntax-capture' : 'syntax-token'
      : token.startsWith('\\') ? 'syntax-token'
        : /^[()[\]{}]/.test(token) ? 'syntax-capture' : 'syntax-special'
    parts.push(<span className={className} key={start}>{token}</span>)
    end = start + token.length
  }

  if (end < value.length) parts.push(value.slice(end))
  return parts
}

function tokenKey(key: string) {
  return key.replace(/^\{/, '').replace(/\}$/, '')
}

export function PatternInput({ id, value, onChange, kind, placeholder, invalid = false }: PatternInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [cursor, setCursor] = useState(value.length)
  const [activeIndex, setActiveIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const match = kind === 'replacement' ? value.slice(0, cursor).match(/\{([^{}]*)$/) : null
  const query = match?.[1].toLowerCase()
  const suggestions = query === undefined ? [] : TOKEN_DEFINITIONS.filter((token) => (
    tokenKey(token.key).toLowerCase().includes(query)
    || tokenKey(token.example).toLowerCase().includes(query)
    || token.label.toLowerCase().includes(query)
  )).slice(0, 8)
  const isOpen = focused && !dismissed && suggestions.length > 0
  const selectedIndex = Math.min(activeIndex, Math.max(0, suggestions.length - 1))
  const menuId = `${id}-suggestions`

  const syncScroll = () => {
    if (highlightRef.current && inputRef.current) {
      highlightRef.current.scrollLeft = inputRef.current.scrollLeft
    }
  }

  useLayoutEffect(syncScroll, [value])
  useEffect(() => setActiveIndex(0), [query])
  useEffect(() => {
    if (!isOpen || !menuRef.current) return
    const option = menuRef.current.children[selectedIndex] as HTMLElement | undefined
    if (!option) return
    const menu = menuRef.current
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight
    }
  }, [isOpen, selectedIndex])

  const insertToken = (key: string) => {
    if (!match) return
    const start = cursor - match[0].length
    const token = `{${tokenKey(key)}}`
    const closingToken = value.slice(cursor).match(/^[^{}]*\}/)
    const end = cursor + (closingToken?.[0].length ?? 0)
    const nextCursor = start + token.length
    onChange(value.slice(0, start) + token + value.slice(end))
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

  return (
    <div className={`pattern-input-wrap${invalid ? ' is-invalid' : ''}`}>
      <pre ref={highlightRef} className="pattern-highlight" aria-hidden="true">
        {value ? highlight(value, kind) : <span className="pattern-placeholder">{placeholder}</span>}
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
        role={kind === 'replacement' ? 'combobox' : undefined}
        aria-autocomplete={kind === 'replacement' ? 'list' : undefined}
        aria-expanded={kind === 'replacement' ? isOpen : undefined}
        aria-controls={isOpen ? menuId : undefined}
        aria-activedescendant={isOpen ? `${menuId}-${selectedIndex}` : undefined}
        onChange={(event) => {
          setCursor(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
          setDismissed(false)
          onChange(event.currentTarget.value)
        }}
        onFocus={(event) => {
          setFocused(true)
          setCursor(event.currentTarget.selectionStart ?? value.length)
          setDismissed(false)
        }}
        onBlur={() => setFocused(false)}
        onSelect={(event) => setCursor(event.currentTarget.selectionStart ?? value.length)}
        onScroll={syncScroll}
        onKeyDown={handleKeyDown}
      />
      {isOpen && (
        <div ref={menuRef} className="autocomplete-menu" id={menuId} role="listbox" aria-label="File metadata">
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

import { useId, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { MODIFIER_DEFINITIONS, validateMetadataModifiers } from '@/lib/metadata-modifiers'
import { scanMetadataTokens } from '@/lib/metadata-pattern'
import { resolveFileToken, TOKEN_DEFINITIONS, validateTokenFormat, type FileEntry } from '@/lib/rename'
import { Button } from './ui/button'
import './metadata-pattern-builder.css'

interface MetadataPatternBuilderProps {
  initialToken?: string
  file?: FileEntry
  index?: number
  onInsert: (pattern: string) => void
}

export function MetadataPatternBuilder({ initialToken = 'name', file, index, onInsert }: MetadataPatternBuilderProps) {
  const id = useId()
  const nextId = useRef(0)
  const modifierInputs = useRef(new Map<number, HTMLInputElement>())
  const picker = useRef<HTMLSelectElement>(null)
  const pendingFocus = useRef<number | 'picker' | null>(null)
  const [tokenKey, setTokenKey] = useState(initialToken)
  const [format, setFormat] = useState('')
  const [modifiers, setModifiers] = useState<Array<{ id: number; expression: string }>>([])
  const [modifierKey, setModifierKey] = useState('trim')
  useLayoutEffect(() => {
    if (pendingFocus.current === 'picker') picker.current?.focus()
    else if (pendingFocus.current !== null) modifierInputs.current.get(pendingFocus.current)?.focus()
    pendingFocus.current = null
  }, [modifiers])
  const token = TOKEN_DEFINITIONS.find(candidate => candidate.key === tokenKey)!
  const selectedModifier = MODIFIER_DEFINITIONS.find(candidate => candidate.key === modifierKey)!
  const pattern = `{${tokenKey}${format ? `:${format}` : ''}${modifiers.map(modifier => `|${modifier.expression}`).join('')}}`
  const isDate = tokenKey === 'modified' || tokenKey === 'taken'
  let value: string | undefined
  let error: string | undefined
  try {
    const parsed = scanMetadataTokens(pattern, true)
    if (parsed.length !== 1 || !parsed[0].complete || parsed[0].end !== pattern.length || parsed[0].error) {
      throw new Error(parsed[0]?.error ?? 'Check the modifier syntax and close any quotes or parentheses.')
    }
    validateTokenFormat(tokenKey, parsed[0].format)
    validateMetadataModifiers(parsed[0].modifiers)
    if (file) {
      if (tokenKey === 'index' && index === undefined) throw new Error('Select this file and match its name to assign a sequence number.')
      value = resolveFileToken(file, tokenKey, parsed[0].format, index ?? 1, parsed[0].modifiers)
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'Could not format this value.'
  }

  function moveModifier(position: number, delta: number) {
    setModifiers(current => {
      const next = [...current]
      const modifier = next[position]
      next[position] = next[position + delta]
      next[position + delta] = modifier
      return next
    })
  }

  return <div className="metadata-builder">
    <div className="metadata-builder-field">
      <label htmlFor={`${id}-token`}>Metadata</label>
      <select id={`${id}-token`} value={tokenKey} onChange={event => { setTokenKey(event.target.value); setFormat(''); setModifiers([]) }}>
        {TOKEN_DEFINITIONS.map(candidate => <option key={candidate.key} value={candidate.key}>{candidate.label}</option>)}
      </select>
      <p>{token.description}</p>
    </div>
    {(isDate || tokenKey === 'index') && <div className="metadata-builder-field">
      <label htmlFor={`${id}-format`}>{isDate ? 'Date format (UTC)' : 'Index digits'}</label>
      <input id={`${id}-format`} value={format} placeholder={isDate ? 'YYYY-MM-DD' : '1'} onChange={event => setFormat(event.target.value)} />
    </div>}
    <div className="modifier-chain-heading"><span>Modifiers</span><small>Applied from top to bottom</small></div>
    {modifiers.length > 0 ? <ol className="modifier-chain">
      {modifiers.map((modifier, position) => <li key={modifier.id}>
        <span className="modifier-position" aria-hidden="true">{position + 1}</span>
        <input ref={input => { if (input) modifierInputs.current.set(modifier.id, input); else modifierInputs.current.delete(modifier.id) }} aria-label={`Modifier ${position + 1}`} value={modifier.expression} spellCheck={false} onChange={event => {
          const expression = event.target.value
          setModifiers(current => current.map(candidate => candidate.id === modifier.id ? { ...candidate, expression } : candidate))
        }} />
        <button type="button" aria-label={`Move modifier ${position + 1} up`} disabled={position === 0} onClick={() => moveModifier(position, -1)}><ArrowUp size={14} /></button>
        <button type="button" aria-label={`Move modifier ${position + 1} down`} disabled={position === modifiers.length - 1} onClick={() => moveModifier(position, 1)}><ArrowDown size={14} /></button>
        <button type="button" aria-label={`Remove modifier ${position + 1}`} onClick={() => {
          pendingFocus.current = modifiers[position + 1]?.id ?? modifiers[position - 1]?.id ?? 'picker'
          setModifiers(current => current.filter(candidate => candidate.id !== modifier.id))
        }}><X size={14} /></button>
      </li>)}
    </ol> : <p className="modifier-empty">Start with a value, then make it your own.</p>}
    <div className="metadata-builder-field">
      <label htmlFor={`${id}-modifier`}>Add a modifier</label>
      <div className="modifier-picker">
        <select ref={picker} id={`${id}-modifier`} value={modifierKey} onChange={event => setModifierKey(event.target.value)}>
          {MODIFIER_DEFINITIONS.map(modifier => <option key={modifier.key} value={modifier.key}>{modifier.label}</option>)}
        </select>
        <Button variant="outline" size="sm" onClick={() => {
          const modifierId = nextId.current++
          pendingFocus.current = modifierId
          setModifiers(current => [...current, { id: modifierId, expression: selectedModifier.example }])
        }}><Plus size={14} />Add</Button>
      </div>
      <p>{selectedModifier.description}</p>
    </div>
    <p className="modifier-help">Edit the arguments above to choose your own text or numbers. Use quotes around text, for example <code>{'replace(" ","-")'}</code>.</p>
    <div className="metadata-builder-preview" aria-live="polite" aria-atomic="true">
      <span>Name pattern</span><code>{pattern}</code>
      <span>{file ? `Value for ${file.name}` : 'Value preview'}</span>
      {error ? <p className="field-error">{error}</p> : <output>{value === undefined ? 'Open a folder to preview this value.' : value || '(empty)'}</output>}
    </div>
    <p className="modifier-help">Insert adds this token to the end of your name pattern. The file list checks the complete names for conflicts.</p>
    <div className="metadata-builder-actions"><Button disabled={!!error} onClick={() => onInsert(pattern)}>Insert pattern<Plus size={15} /></Button></div>
  </div>
}

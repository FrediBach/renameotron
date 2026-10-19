import { useId, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { compileConditionalPattern } from '@/lib/conditional-pattern'
import type { CaptureGroup } from '@/lib/highlight-types'
import { buildRenamePlan, type FileEntry } from '@/lib/rename'
import { PatternInput } from './PatternInput'
import { Button } from './ui/button'
import './condition-pattern-builder.css'

interface ConditionPatternBuilderProps {
  pattern: string
  replacement: string
  flags: string
  files: FileEntry[]
  selectedIds: Set<string>
  captureGroups?: CaptureGroup[]
  onInsert: (pattern: string) => void
}

export function ConditionPatternBuilder({ pattern, replacement, flags, files, selectedIds, captureGroups, onInsert }: ConditionPatternBuilderProps) {
  const id = useId()
  const [condition, setCondition] = useState('orientation:landscape')
  const [thenPattern, setThenPattern] = useState('photos/landscape/originals/$&')
  const [elsePattern, setElsePattern] = useState('photos/other/$&')
  const block = `{if ${condition}}${thenPattern}{else}${elsePattern}{end}`
  const fullPattern = replacement + block
  const preview = useMemo(() => {
    try {
      compileConditionalPattern(fullPattern)
      const plan = buildRenamePlan(files, pattern, fullPattern, flags, selectedIds)
      if (plan.error) return { error: plan.error }
      if (plan.replacementError) return { error: plan.replacementError }
      const row = plan.rows.find(candidate => candidate.status !== 'unmatched')
      return { row, error: row?.error }
    } catch (caught) {
      return { error: caught instanceof Error ? caught.message : 'Check the condition and branch patterns.' }
    }
  }, [fullPattern, files, pattern, flags, selectedIds])

  return <div className="condition-builder">
    <div className="condition-builder-field">
      <label htmlFor={`${id}-when`}>When</label>
      <input className="condition-query" id={`${id}-when`} value={condition} spellCheck={false} autoComplete="off" autoCapitalize="off" aria-describedby={`${id}-when-help`} onChange={event => setCondition(event.target.value)} />
      <p id={`${id}-when-help`}>Use file search conditions, such as <code>orientation:landscape</code>, <code>width&gt;=3000</code>, or <code>has:taken</code>. Separate conditions with spaces to require all of them; use <code>OR</code> for alternatives. Conditions read the original file’s metadata.</p>
    </div>
    <div className="condition-builder-field">
      <label htmlFor={`${id}-then`}>Then</label>
      <PatternInput id={`${id}-then`} value={thenPattern} onChange={setThenPattern} kind="replacement" captureGroups={captureGroups} placeholder="photos/landscape/originals/$&" />
      <p>Use this text when the condition matches.</p>
    </div>
    <div className="condition-builder-field">
      <label htmlFor={`${id}-otherwise`}>Otherwise</label>
      <PatternInput id={`${id}-otherwise`} value={elsePattern} onChange={setElsePattern} kind="replacement" captureGroups={captureGroups} placeholder="photos/other/$&" />
      <p>Use this text when the condition does not match. Missing metadata makes a direct comparison false.</p>
    </div>
    <p className="condition-help">Both branches support metadata, modifiers, and capture groups. <code>$&amp;</code> keeps the matched filename. Use <code>^.+$</code> in Find to match the whole name.</p>
    <div className="condition-preview" aria-live="polite" aria-atomic="true">
      <span>Condition block</span><code>{block}</code>
      <span>{preview.row ? `Full path for ${preview.row.file.path}` : 'Full path preview'}</span>
      {preview.error ? <p className="field-error" role="alert">{preview.error}</p> : <output>{preview.row?.targetPath ?? (files.length ? 'Select a file that matches your Find pattern to preview its path.' : 'Open a folder to preview the complete path.')}</output>}
    </div>
    <p className="condition-help">Insert adds this block to the end of your name pattern. The preview includes your existing pattern. Use <code>{'{elseif width>=3000}'}</code> in the pattern for additional branches.</p>
    <div className="condition-builder-actions"><Button disabled={!!preview.error} onClick={() => onInsert(block)}>Insert condition<Plus size={15} /></Button></div>
  </div>
}

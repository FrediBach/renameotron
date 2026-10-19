import { useId, useRef, useState } from 'react'
import { CircleHelp, Search, X } from 'lucide-react'
import './file-search.css'

const quickFilters = [
  { label: 'Images', query: 'type:image' },
  { label: 'Under 24 MB', query: 'size<24MB' },
  { label: 'Landscape', query: 'aspect:landscape' },
  { label: 'After 2024, before 2026', query: 'date>2024 date<2026' },
]

const fieldExamples = [
  ['Type & extension', 'type:image', 'type:video', 'type:audio', 'type:document', 'type:archive', 'ext:jpg'],
  ['Size', 'size<24MB', 'size>=1MiB'],
  ['Dates', 'date:2025', 'modified>=2024-06', 'taken<2026-01-01'],
  ['Image details', 'aspect:landscape', 'orientation:portrait', 'aspect:16:9', 'width>=1920', 'height>1080', 'megapixels>=12'],
  ['Names & paths', 'name:holiday', 'name="holiday.jpg"', 'path:"Summer trip"', 'to:studio'],
  ['Metadata', 'camera:"Fujifilm"', 'has:taken', 'metadata.lensModel:"Summilux"'],
  ['Preview', 'status:ready', 'status:"no match"', 'index<=10'],
]

interface FileSearchProps {
  value: string
  onChange: (value: string) => void
  resultCount: string
  error?: { message: string; position: number }
}

export function FileSearch({ value, onChange, resultCount, error }: FileSearchProps) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const helpButton = useRef<HTMLButtonElement>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  function addFilter(query: string) {
    onChange(value.trim() ? `(${value.trim()}) ${query}` : query)
    input.current?.focus()
  }

  return <div className="file-search-control">
    <div className={`preview-search-row${error ? ' search-has-error' : ''}`}>
      <div className="file-search">
        <Search size={15} aria-hidden="true" />
        <input ref={input} aria-label="Search files" aria-invalid={!!error}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
          placeholder="Search files… try type:image size<24MB" spellCheck={false} autoComplete="off"
          value={value} onChange={event => onChange(event.target.value)} />
        {value && <button type="button" onClick={() => { onChange(''); input.current?.focus() }} aria-label="Clear search" title="Clear search"><X size={14} /></button>}
      </div>
      <span className="preview-result-count" aria-live="polite" aria-atomic="true">{resultCount}</span>
      <button ref={helpButton} type="button" className="search-help-toggle" aria-label="Search syntax" aria-expanded={helpOpen}
        aria-controls={`${id}-guide`} title="Search syntax and examples" onClick={() => setHelpOpen(open => !open)}>
        <CircleHelp size={15} aria-hidden="true" /><span>Syntax</span>
      </button>
    </div>
    <p className="sr-only" id={`${id}-hint`}>Search words or combine filters, for example type:image size&lt;24MB. Spaces mean AND. Use OR, NOT, and parentheses for alternatives and exclusions. Open Search syntax for examples.</p>
    {error && <p className="file-search-error" id={`${id}-error`} role="status"><strong>Check your search:</strong> {error.message} <span>At character {error.position + 1}.</span></p>}
    {helpOpen && <section className="file-search-guide" id={`${id}-guide`} aria-label="Search syntax guide"
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setHelpOpen(false); helpButton.current?.focus() } }}>
      <div className="search-guide-intro"><h3>A few words. Any combination.</h3><p>Search normally, or add <code>field:value</code> filters. Spaces mean <code>AND</code>.</p></div>
      <div className="search-quick-filters">{quickFilters.map(filter => <button type="button" key={filter.query} aria-label={`Add filter ${filter.query}`} onClick={() => addFilter(filter.query)}>
        <span>{filter.label}</span><code>{filter.query}</code>
      </button>)}</div>
      <p className="search-guide-tip">Click a filter to add it to your search.</p>
      <div className="search-combination"><code>type:image date&gt;2024 date&lt;2026 size&lt;24MB aspect:landscape</code><p>Landscape images under 24 MB, modified in 2025.</p></div>
      <dl className="search-operators">
        <div><dt>Combine</dt><dd><code>(ext:jpg OR ext:png) NOT name:copy</code><span>Group alternatives with parentheses. Exclude with <code>NOT</code> or <code>-</code>. AND binds before OR.</span></dd></div>
        <div><dt>Be precise</dt><dd><code>camera="Fujifilm X100VI" size&lt;=24MB</code><span><code>:</code> contains text; <code>=</code> matches the whole value. Types, extensions, orientation, and status always match exactly. Comparisons: <code>&lt; &lt;= &gt; &gt;= !=</code>.</span></dd></div>
        <div><dt>Use phrases</dt><dd><code>"summer trip" type:image</code><span>Quote text with spaces or search punctuation. Searches ignore case; write <code>AND OR NOT</code> in capitals.</span></dd></div>
      </dl>
      <details className="search-field-reference"><summary>All fields & details</summary>
        <dl>{fieldExamples.map(([label, ...examples]) => <div key={label}><dt>{label}</dt><dd>{examples.map(example => <code key={example}>{example}</code>)}</dd></div>)}</dl>
        <p>Also available: <code>from</code> (same as <code>path</code>), <code>filesize</code> (same as <code>size</code>), <code>dimensions</code>, <code>uuid</code>, and any embedded field as <code>metadata.fieldName</code>. Use <code>has:field</code> to require a value.</p>
        <p><code>date</code> means modified date; <code>taken</code> means photo capture date. Dates use UTC and accept a year, month, or day. <code>date&gt;2024</code> starts in 2025; <code>date&gt;=2024</code> includes 2024.</p>
        <p>MB uses 1,000,000 bytes; MiB uses 1,048,576 bytes. Spaces in sizes are fine: <code>size &lt; 24 MB</code>. Image dimensions require metadata. Missing values fail comparisons; <code>NOT has:taken</code> finds missing capture dates.</p>
        <p>Filtering changes the view. Renaming still applies to all selected matches, including hidden files.</p>
      </details>
    </section>}
  </div>
}

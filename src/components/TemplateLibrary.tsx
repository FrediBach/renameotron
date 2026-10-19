import { useId, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Search, SlidersHorizontal, X } from 'lucide-react'
import { DialogDescription, DialogTitle } from './ui/dialog'
import { getTemplateModifiers, matchesTemplateSearch } from '@/lib/template-search'
import { getTemplateExample } from '@/lib/template-examples'
import { TEMPLATE_CATEGORIES, TEMPLATES, type RenameTemplate } from '@/lib/templates'
import './template-library.css'

interface TemplateLibraryProps {
  savedTemplates: RenameTemplate[]
  onApply: (template: RenameTemplate) => void
}

export function TemplateLibrary({ savedTemplates, onApply }: TemplateLibraryProps) {
  const id = useId()
  const searchInput = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<(typeof TEMPLATE_CATEGORIES)[number]>('All')
  const examples = useMemo(() => new Map([...savedTemplates, ...TEMPLATES].map(template => [template.id, getTemplateExample(template)])), [savedTemplates])
  const matchingTemplates = useMemo(() => [...savedTemplates.map(template => ({ ...template, category: 'Saved' as const })), ...TEMPLATES]
    .filter(template => matchesTemplateSearch(template, query)), [savedTemplates, query])
  const groups = TEMPLATE_CATEGORIES.filter(value => value !== 'All').map(value => ({
    category: value,
    templates: matchingTemplates.filter(template => template.category === value),
  }))
  const visibleGroups = groups.filter(group => group.templates.length && (category === 'All' || group.category === category))
  const count = visibleGroups.reduce((total, group) => total + group.templates.length, 0)
  const hasFilters = query.length > 0 || category !== 'All'

  function resetFilters() {
    setQuery('')
    setCategory('All')
    if (results.current) results.current.scrollTop = 0
    searchInput.current?.focus()
  }

  return <>
    <div className="template-library-header">
      <p className="eyebrow">A GOOD RULE GOES A LONG WAY</p>
      <DialogTitle>A rule for almost everything.</DialogTitle>
      <DialogDescription>{TEMPLATES.length} starting points, grouped by task. Pick one, then make it yours.</DialogDescription>
      <div className="template-search">
        <Search size={17} aria-hidden="true" />
        <input ref={searchInput} aria-label="Search templates" aria-describedby={`${id}-search-hint`} placeholder="Try “slug”, “photo date”, or “invoice”…" value={query} onChange={event => {
          setQuery(event.target.value)
          if (results.current) results.current.scrollTop = 0
        }} />
        {query && <button type="button" aria-label="Clear template search" onClick={() => {
          setQuery('')
          if (results.current) results.current.scrollTop = 0
          searchInput.current?.focus()
        }}><X size={15} /></button>}
      </div>
      <p className="template-search-hint" id={`${id}-search-hint`}>Search names, tasks, metadata, modifiers, and patterns.</p>
      <div className="category-tabs" role="group" aria-label="Template categories">
        {TEMPLATE_CATEGORIES.map(value => <button type="button" aria-pressed={category === value} className={category === value ? 'active' : ''} key={value} onClick={() => {
          setCategory(value)
          if (results.current) results.current.scrollTop = 0
        }}>{value}<span aria-hidden="true">{value === 'All' ? matchingTemplates.length : groups.find(group => group.category === value)?.templates.length ?? 0}</span></button>)}
      </div>
      <div className="template-results-summary">
        <span role="status" aria-live="polite" aria-atomic="true">{count} {count === 1 ? 'template' : 'templates'}{query.trim() ? ' found' : ''}</span>
        {hasFilters && <button type="button" onClick={resetFilters}>Clear filters</button>}
      </div>
    </div>
    <div className="template-results" ref={results}>
      {visibleGroups.map(group => <section className="template-group" key={group.category} aria-labelledby={`${id}-${group.category.replaceAll(' ', '-')}`}>
        <div className="template-group-heading"><h3 id={`${id}-${group.category.replaceAll(' ', '-')}`}>{group.category}</h3><span>{group.templates.length} {group.templates.length === 1 ? 'template' : 'templates'}</span></div>
        <div className="template-grid">{group.templates.map((template, index) => {
          const modifiers = getTemplateModifiers(template)
          const example = examples.get(template.id)!
          const descriptionId = `${id}-${group.category.replaceAll(' ', '-')}-${index}-description`
          return <button type="button" key={template.id} aria-label={template.name} aria-describedby={descriptionId} onClick={() => onApply(template)}>
            <div className="template-card-heading"><h4>{template.name}</h4><ArrowUpRight size={16} aria-hidden="true" /></div>
            <p id={descriptionId}>{template.description}</p>
            <code className="template-regex" aria-label="Regex pattern" title="Regex pattern">/{template.pattern}/{template.flags}</code>
            <code aria-label="Renaming pattern" title={template.replacement}>{template.replacement || '(remove matched text)'}</code>
            <div className="template-example" aria-label="Example rename">
              <div><span>From</span><samp>{example.from}</samp></div>
              <div><span>To →</span><samp>{example.to}</samp></div>
            </div>
            {modifiers.length > 0 && <div className="template-modifiers" aria-label="Modifiers used">
              <SlidersHorizontal size={12} aria-hidden="true" />
              {modifiers.slice(0, 3).map(modifier => <span key={modifier.key} title={modifier.description}>{modifier.key}</span>)}
              {modifiers.length > 3 && <span title={modifiers.slice(3).map(modifier => modifier.label).join(', ')}>+{modifiers.length - 3}</span>}
            </div>}
          </button>
        })}</div>
      </section>)}
      {count === 0 && <div className="template-empty">
        <Search size={25} aria-hidden="true" />
        <h3>{category === 'Saved' && !query.trim() && savedTemplates.length === 0 ? 'Your own rules, right here.' : 'No templates found.'}</h3>
        <p>{category === 'Saved' && !query.trim() && savedTemplates.length === 0 ? 'Use “Save as a template” in the naming rule panel to keep a rule for later.' : 'Try fewer words, another category, or clear the filters to browse everything.'}</p>
      </div>}
    </div>
  </>
}

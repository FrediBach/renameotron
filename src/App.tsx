import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronDown, CircleHelp, Copy, File, FileImage, FileText, Folder, FolderOpen, History, Image, Layers3, LoaderCircle, LockKeyhole, Plus, RotateCcw, Search, SlidersHorizontal, Sparkles, WandSparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { PatternInput } from '@/components/PatternInput'
import { MatchedFilename } from '@/components/MatchedFilename'
import { HighlightedText } from '@/components/HighlightedText'
import { compileHighlightRegex } from '@/lib/match-highlights'
import { captureLabel, tokenizeRegex } from '@/lib/pattern-highlights'
import { buildRenamePlan, formatBytes, TOKEN_DEFINITIONS, type FileEntry } from '@/lib/rename'
import { TEMPLATES, type RenameTemplate } from '@/lib/templates'
import { createDemoFiles } from '@/lib/demo'
import { applyRenamePlan, pickDirectory, scanDirectory } from '@/lib/filesystem'

type Receipt = { source: string; destination: string; success: boolean; error?: string }
type SavedRun = { at: string; demo: boolean; results: Receipt[] }
const DEFAULT_PATTERN = '^IMG_(\\d+)\\.(jpg|png)$'
const DEFAULT_REPLACEMENT = 'studio-{index:3}.{ext}'

function readSavedTemplates(): RenameTemplate[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem('renameotron.templates') ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is RenameTemplate => item && typeof item === 'object' && ['id', 'name', 'description', 'pattern', 'replacement', 'flags', 'category'].every(key => typeof item[key] === 'string'))
  } catch { return [] }
}

function FileIcon({ file }: { file: FileEntry }) {
  const Icon = file.type.startsWith('image/') ? FileImage : file.type.includes('text') || file.type === 'application/pdf' ? FileText : File
  return <span className={`file-icon ${file.type.startsWith('image/') ? 'is-image' : ''}`}><Icon size={17} strokeWidth={1.5} /></span>
}

export default function App() {
  const [files, setFiles] = useState<FileEntry[]>(createDemoFiles)
  const [directory, setDirectory] = useState<FileSystemDirectoryHandle | null>(null)
  const [selectedIds, setSelectedIds] = useState(() => new Set(createDemoFiles().map(file => file.id)))
  const [pattern, setPattern] = useState(DEFAULT_PATTERN)
  const [replacement, setReplacement] = useState(DEFAULT_REPLACEMENT)
  const [ignoreCase, setIgnoreCase] = useState(true)
  const [globalMatch, setGlobalMatch] = useState(false)
  const [recursive, setRecursive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null)
  const [filter, setFilter] = useState<'all' | 'matched'>('all')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<'templates' | 'guide' | 'confirm' | 'history' | 'save' | null>(null)
  const [templateSearch, setTemplateSearch] = useState('')
  const [templateCategory, setTemplateCategory] = useState('All')
  const [savedTemplates, setSavedTemplates] = useState<RenameTemplate[]>(readSavedTemplates)
  const [templateName, setTemplateName] = useState('')
  const [activeTemplate, setActiveTemplate] = useState('Photo series')
  const [method, setMethod] = useState<'native' | 'copy'>('native')
  const [history, setHistory] = useState<SavedRun[]>([])
  const [demoUndo, setDemoUndo] = useState<FileEntry[] | null>(null)
  const [showTokens, setShowTokens] = useState(false)
  const demo = directory === null
  const flags = `${globalMatch ? 'g' : ''}${ignoreCase ? 'i' : ''}`
  const plan = useMemo(() => buildRenamePlan(files, pattern, replacement, flags, selectedIds), [files, pattern, replacement, flags, selectedIds])
  const highlightRegex = useMemo(() => compileHighlightRegex(pattern, flags), [pattern, flags])
  const captureGroups = useMemo(() => tokenizeRegex(pattern).groups, [pattern])
  const visibleRows = plan.rows.filter(row => (filter === 'all' || row.status !== 'unmatched') && `${row.file.path} ${row.targetPath}`.toLowerCase().includes(search.toLowerCase()))
  const totalSize = files.reduce((size, file) => size + file.size, 0)
  const allSelected = files.length > 0 && selectedIds.size === files.length
  const canRename = plan.readyCount > 0 && plan.errorCount === 0 && !plan.error && !busy
  const allTemplates = [...savedTemplates, ...TEMPLATES]
  const templateCategories = ['All', 'Saved', ...Array.from(new Set(TEMPLATES.map(template => template.category)))]
  const shownTemplates = allTemplates.filter(template => (templateCategory === 'All' || (templateCategory === 'Saved' ? savedTemplates.some(saved => saved.id === template.id) : template.category === templateCategory)) && `${template.name} ${template.description}`.toLowerCase().includes(templateSearch.toLowerCase()))

  useEffect(() => {
    if (!notice || notice.error) return
    const timer = window.setTimeout(() => setNotice(null), 6500)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canRename && !modal) { event.preventDefault(); setModal('confirm') }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [canRename, modal])

  function loadFiles(next: FileEntry[], preserveSelection = false) {
    const previousIds = new Set(files.map(file => file.id))
    setFiles(next)
    setSelectedIds(current => new Set(next.filter(file => !preserveSelection || !previousIds.has(file.id) || current.has(file.id)).map(file => file.id)))
    setSearch('')
  }

  async function openFolder() {
    setBusy(true); setProgress('Opening folder…')
    try {
      const root = await pickDirectory()
      setProgress('Reading files…')
      const next = await scanDirectory(root, recursive)
      setDirectory(root); loadFiles(next); setDemoUndo(null); setNotice(null)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setNotice({ message: error instanceof Error ? error.message : 'Could not open that folder.', error: true })
    } finally { setBusy(false); setProgress('') }
  }

  async function rescan(nextRecursive = recursive) {
    if (!directory) { setRecursive(nextRecursive); return }
    setBusy(true); setProgress('Reading files…')
    try { loadFiles(await scanDirectory(directory, nextRecursive), true); setRecursive(nextRecursive) }
    catch (error) { setNotice({ message: error instanceof Error ? error.message : 'Could not read the folder.', error: true }) }
    finally { setBusy(false); setProgress('') }
  }

  function toggleFile(id: string) {
    setSelectedIds(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  function applyTemplate(template: RenameTemplate) {
    setPattern(template.pattern); setReplacement(template.replacement)
    setIgnoreCase(template.flags.includes('i')); setGlobalMatch(template.flags.includes('g'))
    setActiveTemplate(template.name); setModal(null)
  }

  function resetDemo() {
    setDirectory(null); loadFiles(createDemoFiles()); setDemoUndo(null)
    setPattern(DEFAULT_PATTERN); setReplacement(DEFAULT_REPLACEMENT); setIgnoreCase(true); setGlobalMatch(false); setActiveTemplate('Photo series'); setNotice(null)
  }

  async function executeRename() {
    if (!canRename) return
    setModal(null); setBusy(true); setProgress('Preparing rename…')
    const ready = plan.rows.filter(row => row.status === 'ready')
    try {
      let results: Receipt[]
      if (demo) {
        setDemoUndo(files)
        results = ready.map(row => ({ source: row.file.path, destination: row.targetPath, success: true }))
        const names = new Map(ready.map(row => [row.file.id, row.targetPath]))
        setFiles(current => current.map(file => { const target = names.get(file.id); return target ? { ...file, path: target, name: target.split('/').at(-1)! } : file }))
      } else {
        const result = await applyRenamePlan(directory, ready, method, (completed, total) => setProgress(`Renaming ${completed} of ${total}…`))
        results = result.results
      }
      setHistory(current => [{ at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), demo, results }, ...current])
      const succeeded = results.filter(result => result.success).length
      const failure = results.find(result => !result.success)
      setNotice({ message: failure ? `${succeeded} renamed. ${failure.error ?? 'The batch stopped. Check activity for details.'}` : `${succeeded} ${demo ? 'demo ' : ''}files renamed. A little more order.`, error: !!failure })
      if (!demo) loadFiles(await scanDirectory(directory, recursive), true)
    } catch (error) { setNotice({ message: error instanceof Error ? error.message : 'The rename could not finish.', error: true }) }
    finally { setBusy(false); setProgress('') }
  }

  function saveTemplate() {
    if (!templateName.trim()) return
    const next: RenameTemplate[] = [{ id: crypto.randomUUID(), name: templateName.trim(), description: 'Your saved naming rule.', pattern, replacement, flags, category: 'Saved' }, ...savedTemplates]
    try { localStorage.setItem('renameotron.templates', JSON.stringify(next)); setSavedTemplates(next); setModal(null); setTemplateName(''); setNotice({ message: 'Template saved in this browser.' }) }
    catch { setNotice({ message: 'This browser could not save the template.', error: true }) }
  }

  function downloadReceipt() {
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url; link.download = 'renameotron-activity.json'; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <div className="app-shell">
    <header className="site-header">
      <a className="brand" href="/" aria-label="renameotron home"><img src="/favicon.svg" width="33" height="33" alt="" /><span>renameotron<span className="brand-period">.</span></span></a>
      <nav aria-label="Main navigation"><button onClick={() => setModal('templates')}><Layers3 size={15} />Templates</button><button onClick={() => setModal('guide')}><CircleHelp size={15} />How it works</button><span className="header-divider" /><span className="local-label"><span className="status-dot" />100% local</span></nav>
    </header>

    <main aria-label="Batch rename files">
      <section className="folder-bar" aria-label="Selected folder">
        <div className="folder-symbol"><FolderOpen size={23} strokeWidth={1.5} /></div>
        <div className="folder-details"><div><h2>{demo ? 'Studio selects' : directory.name}</h2>{demo && <span className="demo-badge">DEMO FOLDER</span>}</div><p>{files.length} files <span>·</span> {formatBytes(totalSize)} <span>·</span> {demo ? 'A few sample files to make yourself at home.' : 'Connected to your device'}</p></div>
        <div className="folder-actions">{!demo && <Button variant="ghost" size="icon" aria-label="Refresh folder" disabled={busy} onClick={() => void rescan()}><RotateCcw size={16} /></Button>}<Button variant="outline" disabled={busy} onClick={() => void openFolder()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Folder size={15} />}Open folder<ArrowUpRight size={14} /></Button></div>
      </section>

      <div className="workspace" inert={busy}>
        <aside className="rule-panel" aria-label="Rename rule">
          <div className="panel-heading"><h2>The naming rule</h2><span className="tiny-label">01 — 02</span></div>
          <div className="rule-body">
            <div className="rule-step"><div className="step-label"><span className="step-number">01</span><label htmlFor="match-pattern">Find a pattern</label><button className="text-help" onClick={() => setModal('guide')} aria-label="Regex syntax help"><CircleHelp size={14} /></button></div>
              <PatternInput id="match-pattern" value={pattern} onChange={value => { setPattern(value); setActiveTemplate('Custom rule') }} kind="regex" invalid={!!plan.error} placeholder="e.g. ^IMG_(\\d+)\\.jpg$" />
              {plan.error ? <p className="field-error" role="alert">{plan.error}</p> : <p className="field-hint">Match filenames with a regular expression.</p>}
              <div className="regex-options"><label><Checkbox checked={ignoreCase} onCheckedChange={checked => { setIgnoreCase(!!checked); setActiveTemplate('Custom rule') }} /><span>Ignore case</span><code>i</code></label><label><Checkbox checked={globalMatch} onCheckedChange={checked => { setGlobalMatch(!!checked); setActiveTemplate('Custom rule') }} /><span>Global</span><code>g</code></label></div>
              {captureGroups.length > 0 && !plan.error && <div className="capture-key" aria-label="Capture groups"><span>Use a group</span>{captureGroups.map(group => <button key={group.index} className={`hl-group-${(group.index - 1) % 6 + 1}`} title={`${captureLabel(group)} — insert into replacement`} aria-label={`Insert capture group ${group.index}${group.name ? ` (${group.name})` : ''}`} onClick={() => { setReplacement(current => current + (group.name ? `$<${group.name}>` : `$${group.index}`)); setActiveTemplate('Custom rule') }}>${group.index}</button>)}</div>}
            </div>
            <div className="step-connector"><ArrowDown size={15} /></div>
            <div className="rule-step"><div className="step-label"><span className="step-number">02</span><label htmlFor="replacement-pattern">Give it a new name</label></div>
              <PatternInput id="replacement-pattern" value={replacement} onChange={value => { setReplacement(value); setActiveTemplate('Custom rule') }} kind="replacement" captureGroups={captureGroups} placeholder="e.g. photo-{index:3}.{ext}" />
              <p className="field-hint">Add text, capture groups, or a little metadata.</p>
              <div className="token-chips">{['{name}', '{ext}', '{index:3}'].map(token => <button key={token} className={`metadata-token-chip hl-token-${token.slice(1, -1).split(':')[0]}`} onClick={() => { setReplacement(current => current + token); setActiveTemplate('Custom rule') }}>{token}</button>)}<button className={showTokens ? 'token-more active' : 'token-more'} onClick={() => setShowTokens(!showTokens)} aria-label="More metadata tokens" aria-expanded={showTokens}><Plus size={13} /></button></div>
              {showTokens && <div className="token-browser">{TOKEN_DEFINITIONS.map(token => <button key={token.key} onClick={() => { setReplacement(current => current + token.example); setActiveTemplate('Custom rule') }}><code>{token.example}</code><span>{token.label}</span></button>)}</div>}
              <div className="subfolder-tip"><Folder size={13} /><p>Use <code>/</code> to put files in a new subfolder.</p></div>
            </div>
            <div className="rule-settings"><SlidersHorizontal size={14} /><label htmlFor="recursive">Include subfolders</label><Switch id="recursive" checked={recursive} disabled={busy} onCheckedChange={value => void rescan(value)} /></div>
            <Button className="save-rule" variant="ghost" onClick={() => { setTemplateName(activeTemplate === 'Custom rule' ? '' : activeTemplate); setModal('save') }}><Plus size={14} />Save as a template</Button>
          </div>
          <div className="starter-templates"><div className="starter-heading"><span>A GOOD PLACE TO START</span><Sparkles size={13} /></div>
            {[{ name: 'Photo series', description: 'A name. A number. A little order.', icon: Image, pattern: DEFAULT_PATTERN, replacement: DEFAULT_REPLACEMENT, flags: 'i' }, { name: 'Date & name', description: 'Keep the when with the what.', icon: History, pattern: '^(.+)$', replacement: '{modified:YYYY-MM-DD}_{name}.{ext}', flags: '' }, { name: 'Into folders', description: 'Everything in its right place.', icon: Folder, pattern: '^(.+)$', replacement: '{ext}/{name}.{ext}', flags: '' }].map(template => <button className={`starter-card ${activeTemplate === template.name ? 'selected' : ''}`} key={template.name} onClick={() => applyTemplate({ ...template, id: template.name, category: 'Everyday' })}><span className="starter-icon"><template.icon size={17} strokeWidth={1.5} /></span><span><strong>{template.name}</strong><small>{template.description}</small></span>{activeTemplate === template.name ? <Check size={14} /> : <ArrowUpRight size={14} />}</button>)}
            <button className="browse-templates" onClick={() => setModal('templates')}>Explore all {TEMPLATES.length} templates<ArrowRight size={14} /></button>
          </div>
        </aside>

        <section className="preview-panel" aria-label="Live rename preview" aria-busy={busy}>
          <div className="preview-heading"><div><h2>The preview</h2><span className="live-badge"><span className="status-dot" />LIVE</span></div><button className="activity-button" onClick={() => setModal('history')} aria-label="Rename activity"><History size={16} /><span>Activity</span>{history.length > 0 && <span className="activity-count">{history.length}</span>}</button></div>
          <div className="preview-toolbar"><div className="view-tabs" aria-label="Filter files"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All files<span>{files.length}</span></button><button className={filter === 'matched' ? 'active' : ''} onClick={() => setFilter('matched')}>Matched<span>{plan.matchedCount}</span></button></div><div className="file-search"><Search size={14} /><input aria-label="Search files" placeholder="Find a file…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={12} /></button>}</div></div>
          <div className="file-table-scroll"><table className="file-table"><thead><tr><th className="check-cell"><Checkbox aria-label="Select all files" checked={allSelected ? true : selectedIds.size ? 'indeterminate' : false} onCheckedChange={checked => setSelectedIds(checked ? new Set(files.map(file => file.id)) : new Set())} /></th><th>FROM <ChevronDown size={11} /></th><th className="arrow-cell" /><th>TO</th><th className="size-cell">SIZE</th><th className="status-cell" /></tr></thead><tbody>{visibleRows.map(row => <tr key={row.file.id} className={`${row.status === 'unmatched' ? 'unmatched-row' : ''} ${row.status === 'error' ? 'error-row' : ''}`}><td className="check-cell"><Checkbox aria-label={`Select ${row.file.name}`} checked={selectedIds.has(row.file.id)} onCheckedChange={() => toggleFile(row.file.id)} /></td><td><div className="filename-cell"><FileIcon file={row.file} /><MatchedFilename file={row.file} regex={highlightRegex} enabled={row.status !== 'unmatched'} /></div></td><td className="arrow-cell"><ArrowRight size={13} /></td><td><span className={`target-name ${row.status === 'ready' ? 'will-rename' : ''}`} title={row.error ?? row.targetPath}>{row.status === 'unmatched' ? <span className="no-match">{selectedIds.has(row.file.id) ? 'No match' : 'Excluded'}</span> : <HighlightedText text={row.targetPath} spans={row.targetHighlights ?? []} />}</span>{row.status === 'error' && <small className="row-error">{row.error}</small>}</td><td className="size-cell">{formatBytes(row.file.size)}</td><td className="status-cell">{row.status === 'ready' && <span className="ready-dot" title="Ready to rename" />}{row.status === 'error' && <span className="error-mark" title={row.error}>!</span>}{row.status === 'unchanged' && <Check size={12} />}</td></tr>)}</tbody></table>
            {visibleRows.length === 0 && <div className="empty-state"><Search size={25} /><h3>{files.length === 0 ? 'A clean slate.' : 'No files in this view.'}</h3><p>{files.length === 0 ? 'Open a folder with a few files to get started.' : 'Try another pattern or clear your search.'}</p>{(search || filter === 'matched') && <Button variant="outline" size="sm" onClick={() => { setSearch(''); setFilter('all') }}>Show all files</Button>}</div>}
          </div>
          <div className="preview-legend"><span><span className="ready-dot" />{plan.readyCount} will be renamed</span><span><span className="neutral-dot" />{files.length - plan.readyCount - plan.errorCount} unchanged</span>{plan.errorCount > 0 && <span className="error-text">{plan.errorCount} conflicts</span>}<span className="sort-note">Updates as you type</span></div>
          <div className="rename-action"><div><span className="action-icon"><CheckCheck size={19} /></span><div><strong>{busy ? progress : plan.errorCount ? 'A few names need a second look.' : plan.readyCount ? `${plan.readyCount} files. Ready when you are.` : 'Your files are in good company.'}</strong><p>{demo ? 'Try it out. These are only sample files.' : 'Review the new names before applying changes.'}</p></div></div><Button disabled={!canRename} onClick={() => setModal('confirm')}>{busy ? <LoaderCircle size={15} className="spin" /> : null}Rename {plan.readyCount} files<ArrowRight size={16} /></Button></div>
        </section>
      </div>

      <div className="workspace-footnote"><span><LockKeyhole size={13} />Your files stay yours. Nothing is uploaded. Ever.</span>{demo ? <span>Try the demo, then make it your own.</span> : <button onClick={resetDemo} disabled={busy}>Back to demo <ArrowRight size={12} /></button>}</div>
    </main>

    <footer className="site-footer"><span>Less, but better named.</span><span>RENAMEOTRON <span className="footer-slash">/</span> V.01</span></footer>

    {notice && <div className={`toast ${notice.error ? 'toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.error ? <CircleHelp size={18} /> : <Check size={18} />}</span><p>{notice.message}</p>{demoUndo && !notice.error && <button onClick={() => { loadFiles(demoUndo, true); setDemoUndo(null); setNotice({ message: 'Demo rename undone.' }) }}>Undo</button>}<button aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={16} /></button></div>}

    <Dialog open={modal === 'templates'} onOpenChange={open => !open && setModal(null)}><DialogContent className="templates-dialog"><p className="eyebrow">SKIP THE BLANK PAGE</p><DialogTitle>A rule for almost everything.</DialogTitle><DialogDescription>Thoughtful starting points. Pick one, then make it yours.</DialogDescription><div className="template-search"><Search size={16} /><input aria-label="Search templates" placeholder="Find a template…" value={templateSearch} onChange={event => setTemplateSearch(event.target.value)} /></div><div className="category-tabs">{templateCategories.map(category => <button className={category === templateCategory ? 'active' : ''} key={category} onClick={() => setTemplateCategory(category)}>{category}</button>)}</div><div className="template-grid">{shownTemplates.map(template => <button key={template.id} onClick={() => applyTemplate(template)}><div><WandSparkles size={19} /><ArrowUpRight size={15} /></div><h3>{template.name}</h3><p>{template.description}</p><code>{template.replacement}</code></button>)}{shownTemplates.length === 0 && <div className="template-empty">{templateCategory === 'Saved' ? 'Your saved naming rules will appear here.' : 'No templates found. Try another search.'}</div>}</div></DialogContent></Dialog>

    <Dialog open={modal === 'guide'} onOpenChange={open => !open && setModal(null)}><DialogContent className="guide-dialog"><p className="eyebrow">A QUICK FIELD GUIDE</p><DialogTitle>A little logic. A lot of order.</DialogTitle><DialogDescription>Open a folder, write a rule, and check the preview. Only the Rename button changes your files.</DialogDescription><div className="guide-steps"><p><b>01</b><span><strong>Find what matters.</strong> Your regular expression matches the filename, including its extension. Use parentheses to capture a part you want to keep.</span></p><p><b>02</b><span><strong>Make it your own.</strong> Use <code>$1</code> for the first capture, or add metadata with <code>{'{…}'}</code>. Type <code>{'{'}</code> for suggestions.</span></p><p><b>03</b><span><strong>Review, then rename.</strong> Uncheck files to exclude them. Conflicts and missing metadata are flagged before anything changes.</span></p></div><div className="guide-example"><code>^IMG_(\d+)\.jpg$</code><ArrowDown size={15} /><code>photo-$1.{'{ext}'}</code><p>IMG_1042.jpg <ArrowRight size={12} /> photo-1042.jpg</p></div><h3>The useful little details</h3><div className="guide-tokens">{TOKEN_DEFINITIONS.map(token => <div key={token.key}><code>{token.example}</code><span>{token.description}</span></div>)}</div><p className="guide-note">Plain filenames stay in their current folder. Paths with <code>/</code> start at your selected folder. Photo metadata comes from embedded EXIF; modification dates come from the filesystem. Desktop Chrome or Edge is needed for local folder access. Native rename support varies; copy & delete is available as an explicit alternative.</p></DialogContent></Dialog>

    <Dialog open={modal === 'confirm'} onOpenChange={open => !open && setModal(null)}><DialogContent className="confirm-dialog"><span className="modal-symbol"><FolderOpen size={26} strokeWidth={1.5} /></span><DialogTitle>A new name for {plan.readyCount} files.</DialogTitle><DialogDescription>{demo ? 'This is a practice run with sample files. Your device’s files won’t be changed.' : `Apply the previewed names in “${directory.name}”. New subfolders will be created where needed.`}</DialogDescription><div className="confirmation-preview">{plan.rows.filter(row => row.status === 'ready').slice(0, 3).map(row => <div key={row.file.id}><span>{row.file.path}</span><ArrowRight size={13} /><strong>{row.targetPath}</strong></div>)}{plan.readyCount > 3 && <p>and {plan.readyCount - 3} more files</p>}</div>{!demo && <><fieldset className="method-choice"><legend>Rename method</legend><label><input type="radio" checked={method === 'native'} onChange={() => setMethod('native')} /><span><strong>Native rename</strong><small>Fast, without copying. Requires browser support.</small></span></label><label><input type="radio" checked={method === 'copy'} onChange={() => setMethod('copy')} /><span><strong>Copy & delete</strong><small>Copies each file, checks its size, then removes the original. Needs extra disk space; filesystem timestamps may change.</small></span></label></fieldset><p className="confirm-note">Batches can partially complete. Existing names are never intentionally overwritten. There is no automatic undo for local files; an activity receipt records every attempted change.</p></>}<div className="dialog-actions"><Button variant="outline" onClick={() => setModal(null)}>Keep editing</Button><Button onClick={() => void executeRename()} disabled={!canRename}>{demo ? 'Try the rename' : `Rename ${plan.readyCount} files`}<ArrowRight size={15} /></Button></div></DialogContent></Dialog>

    <Dialog open={modal === 'save'} onOpenChange={open => !open && setModal(null)}><DialogContent><p className="eyebrow">KEEP A GOOD IDEA</p><DialogTitle>Save your naming rule.</DialogTitle><DialogDescription>Available in this browser, whenever you need it.</DialogDescription><form onSubmit={event => { event.preventDefault(); saveTemplate() }}><label className="save-label" htmlFor="template-name">Template name</label><input id="template-name" className="text-input" value={templateName} onChange={event => setTemplateName(event.target.value)} placeholder="e.g. Monthly studio archive" maxLength={80} autoFocus /><div className="saved-pattern"><code>{pattern}</code><ArrowDown size={13} /><code>{replacement}</code></div><div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setModal(null)}>Cancel</Button><Button type="submit" disabled={!templateName.trim()}>Save template<Plus size={15} /></Button></div></form></DialogContent></Dialog>

    <Dialog open={modal === 'history'} onOpenChange={open => !open && setModal(null)}><DialogContent className="history-dialog"><p className="eyebrow">A RECORD OF THE LITTLE THINGS</p><DialogTitle>Your activity.</DialogTitle><DialogDescription>Rename results from this session, one file at a time.</DialogDescription>{history.length === 0 ? <div className="empty-state"><History size={27} /><h3>A fresh start.</h3><p>Your completed renames will appear here.</p></div> : <><div className="history-list">{history.map((run, index) => <section key={`${run.at}-${index}`}><h3>{run.results.filter(result => result.success).length} files renamed <span>{run.demo ? 'Demo · ' : ''}{run.at}</span></h3>{run.results.map((result, resultIndex) => <div className={result.success ? '' : 'error-text'} key={resultIndex}><span>{result.success ? <Check size={13} /> : <X size={13} />}</span><p><span>{result.source}</span><strong>{result.destination}</strong>{result.error && <small>{result.error}</small>}</p></div>)}</section>)}</div><div className="dialog-actions"><Button variant="outline" onClick={downloadReceipt}><Copy size={14} />Export receipt</Button></div></>}</DialogContent></Dialog>
  </div>
}

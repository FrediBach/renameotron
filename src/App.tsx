import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, Check, CheckCheck, CircleHelp, Folder, FolderOpen, History, Image, Layers3, LoaderCircle, Plus, RotateCcw, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { PatternInput } from '@/components/PatternInput'
import { PreviewTable } from '@/components/PreviewTable'
import { FileMetadataDialog } from '@/components/FileMetadataDialog'
import { MetadataPatternBuilder } from '@/components/MetadataPatternBuilder'
import { TemplateLibrary } from '@/components/TemplateLibrary'
import { MODIFIER_DEFINITIONS } from '@/lib/metadata-modifiers'
import { useRenamePreview } from '@/hooks/useRenamePreview'
import { captureLabel } from '@/lib/pattern-highlights'
import { buildRenamePlan, formatBytes, TOKEN_DEFINITIONS, type FileEntry } from '@/lib/rename'
import { TEMPLATES, type RenameTemplate } from '@/lib/templates'
import { createDemoFiles } from '@/lib/demo'
import { applyRenamePlan, pickDirectory, scanDirectory } from '@/lib/filesystem'

import type { Receipt, SavedRun } from '@/lib/activity'
import { ActivityDialog } from '@/components/ActivityDialog'
import { RenameConfirmationDialog } from '@/components/RenameConfirmationDialog'
const DEFAULT_PATTERN = '^IMG_(\\d+)\\.(jpg|png)$'
const DEFAULT_REPLACEMENT = 'studio-{index|pad(3)}.{ext|lower}'

function readSavedTemplates(): RenameTemplate[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem('renameotron.templates') ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is RenameTemplate => item && typeof item === 'object' && ['id', 'name', 'description', 'pattern', 'replacement', 'flags', 'category'].every(key => typeof item[key] === 'string')).map(template => ({ ...template, category: 'Saved' }))
  } catch { return [] }
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
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [modal, setModal] = useState<'templates' | 'guide' | 'confirm' | 'history' | 'save' | 'metadata' | 'modifiers' | null>(null)
  const [inspectedFileId, setInspectedFileId] = useState<string | null>(null)
  const metadataOpener = useRef<HTMLButtonElement | null>(null)
  const templateOpener = useRef<HTMLButtonElement | null>(null)
  const replacementInput = useRef<HTMLInputElement>(null)
  const focusReplacement = useRef(false)
  const [savedTemplates, setSavedTemplates] = useState<RenameTemplate[]>(readSavedTemplates)
  const [templateName, setTemplateName] = useState('')
  const [activeTemplate, setActiveTemplate] = useState('Photo series')
  const [method, setMethod] = useState<'native' | 'copy'>('native')
  const [history, setHistory] = useState<SavedRun[]>([])
  const [demoUndo, setDemoUndo] = useState<FileEntry[] | null>(null)
  const [showTokens, setShowTokens] = useState(false)
  const demo = directory === null
  const flags = `${globalMatch ? 'g' : ''}${ignoreCase ? 'i' : ''}`
  const { plan, highlightRegex, captureGroups, inspectedFile, inspectedIndex, totalSize, canRename } = useRenamePreview({
    files, pattern, replacement, flags, selectedIds, inspectedFileId, busy,
  })

  useEffect(() => {
    if (!notice || notice.error) return
    const timer = window.setTimeout(() => setNotice(null), 6500)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canRename && !modal && !columnsOpen) { event.preventDefault(); setModal('confirm') }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [canRename, modal, columnsOpen])

  function loadFiles(next: FileEntry[], preserveSelection = false) {
    const previousIds = new Set(files.map(file => file.id))
    setFiles(next)
    setSelectedIds(current => new Set(next.filter(file => !preserveSelection || !previousIds.has(file.id) || current.has(file.id)).map(file => file.id)))
    setSearch('')
    setColumnFilters({})
    setInspectedFileId(null)
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

  function inspectFile(file: FileEntry, opener: HTMLButtonElement | null) {
    metadataOpener.current = opener
    focusReplacement.current = false
    setInspectedFileId(file.id)
    setModal('metadata')
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
      setHistory(current => [{ id: crypto.randomUUID(), at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), demo, results }, ...current])
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
      <div className="header-brand">
        <a className="brand" href="/" aria-label="renameotron home"><img src="/favicon.svg" width="32" height="32" alt="" /><span>renameotron<span className="brand-period">.</span></span></a>
        <p className="brand-tagline">The nerdy file renaming bot.</p>
      </div>
      <nav aria-label="Main navigation"><button onClick={event => { templateOpener.current = event.currentTarget; setModal('templates') }}><Layers3 size={15} />Templates</button><button onClick={() => setModal('guide')}><CircleHelp size={15} />How it works</button><span className="header-divider" /><span className="local-label"><span className="status-dot" />100% local</span></nav>
    </header>

    <main aria-label="Batch rename files">
      <FolderBar demo={demo} directoryName={directory?.name} fileCount={files.length} totalSize={totalSize} busy={busy} onRefresh={() => void rescan()} onOpen={() => void openFolder()} />

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
              <PatternInput id="replacement-pattern" inputRef={replacementInput} value={replacement} onChange={value => { setReplacement(value); setActiveTemplate('Custom rule') }} kind="replacement" captureGroups={captureGroups} placeholder="e.g. photo-{index:3}.{ext}" />
              <p className="field-hint">Add text or metadata. Type <code>|</code> inside a token to chain modifiers.</p>
              <div className="token-chips">{['{name}', '{ext}', '{index:3}'].map(token => <button key={token} className={`metadata-token-chip hl-token-${token.slice(1, -1).split(':')[0]}`} onClick={() => { setReplacement(current => current + token); setActiveTemplate('Custom rule') }}>{token}</button>)}<button className={showTokens ? 'token-more active' : 'token-more'} onClick={() => setShowTokens(!showTokens)} aria-label="More metadata tokens" aria-expanded={showTokens}><Plus size={13} /></button><button className="modifier-open" onClick={event => { metadataOpener.current = event.currentTarget; focusReplacement.current = false; setModal('modifiers') }}><SlidersHorizontal size={12} />Modifiers</button></div>
              {showTokens && <div className="token-browser">{TOKEN_DEFINITIONS.map(token => <button key={token.key} onClick={() => { setReplacement(current => current + token.example); setActiveTemplate('Custom rule') }}><code>{token.example}</code><span>{token.label}</span></button>)}</div>}
              <div className="subfolder-tip"><Folder size={13} /><p>Use <code>/</code> to put files in a new subfolder.</p></div>
            </div>
            <div className="rule-settings"><SlidersHorizontal size={14} /><label htmlFor="recursive">Include subfolders</label><Switch id="recursive" checked={recursive} disabled={busy} onCheckedChange={value => void rescan(value)} /></div>
            <Button className="save-rule" variant="ghost" onClick={() => { setTemplateName(activeTemplate === 'Custom rule' ? '' : activeTemplate); setModal('save') }}><Plus size={14} />Save as a template</Button>
          </div>
          <div className="starter-templates"><div className="starter-heading"><span>A GOOD PLACE TO START</span><Sparkles size={13} /></div>
            {[{ name: 'Photo series', description: 'A name. A number. A little order.', icon: Image, pattern: DEFAULT_PATTERN, replacement: DEFAULT_REPLACEMENT, flags: 'i' }, { name: 'Date & name', description: 'Keep the when with the what.', icon: History, pattern: '^.+?(\\.[^.]+)?$', replacement: '{modified|date("YYYY-MM-DD")}_{name|trim|slug|default("file")}$1', flags: '' }, { name: 'Into folders', description: 'Everything in its right place.', icon: Folder, pattern: '^(.+)$', replacement: '{ext|lower|default("no-extension")}/$&', flags: '' }].map(template => <button className={`starter-card ${activeTemplate === template.name ? 'selected' : ''}`} key={template.name} onClick={() => applyTemplate({ ...template, id: template.name, category: 'Everyday' })}><span className="starter-icon"><template.icon size={17} strokeWidth={1.5} /></span><span><strong>{template.name}</strong><small>{template.description}</small></span>{activeTemplate === template.name ? <Check size={14} /> : <ArrowUpRight size={14} />}</button>)}
            <button className="browse-templates" onClick={event => { templateOpener.current = event.currentTarget; setModal('templates') }}>Explore all {TEMPLATES.length} templates<ArrowRight size={14} /></button>
          </div>
        </aside>

        <section className="preview-panel" aria-label="Live rename preview" aria-busy={busy}>
          <div className="preview-heading"><div><h2>The preview</h2><span className="live-badge"><span className="status-dot" />LIVE</span></div><button className="activity-button" onClick={() => setModal('history')} aria-label="Rename activity"><History size={16} /><span>Activity</span>{history.length > 0 && <span className="activity-count">{history.length}</span>}</button></div>
          <PreviewTable
            files={files} plan={plan} selectedIds={selectedIds} highlightRegex={highlightRegex}
            search={search} onSearchChange={setSearch} filter={filter} onFilterChange={setFilter}
            filters={columnFilters} setFilters={setColumnFilters} onColumnsOpenChange={setColumnsOpen}
            onToggleFile={toggleFile} onInspect={inspectFile}
            onSelectFiles={(ids, selected) => setSelectedIds(current => {
              const next = new Set(current)
              for (const id of ids) { if (selected) next.add(id); else next.delete(id) }
              return next
            })}
          />
          <div className="preview-legend"><span><span className="ready-dot" />{plan.readyCount} will be renamed</span><span><span className="neutral-dot" />{files.length - plan.readyCount - plan.errorCount} unchanged</span>{plan.errorCount > 0 && <span className="error-text">{plan.errorCount} conflicts</span>}<span className="metadata-row-hint">Click a row for metadata</span></div>
          <RenameAction plan={plan} busy={busy} progress={progress} demo={demo} canRename={canRename} onConfirm={() => setModal('confirm')} />
        </section>
      </div>

      <footer className="site-footer">
        <a href="https://fredibach.com">© 2026 by Fredi Bach</a>
        <div className="footer-details">
          <span className="footer-version">RENAMEOTRON <span className="footer-slash">/</span> V.01</span>
          {!demo && <button onClick={resetDemo} disabled={busy}>Back to demo <ArrowRight size={12} /></button>}
        </div>
      </footer>
    </main>

    {notice && <NoticeToast notice={notice} canUndo={!!demoUndo} onDismiss={() => setNotice(null)} onUndo={() => {
      if (!demoUndo) return
      loadFiles(demoUndo, true); setDemoUndo(null); setNotice({ message: 'Demo rename undone.' })
    }} />}

    <FileMetadataDialog
      file={inspectedFile}
      index={inspectedIndex || undefined}
      open={modal === 'metadata'}
      onOpenChange={open => !open && setModal(null)}
      onInsert={token => {
        setReplacement(current => current + token)
        setActiveTemplate('Custom rule')
        focusReplacement.current = true
        setModal(null)
      }}
      onCloseAutoFocus={event => {
        event.preventDefault()
        if (focusReplacement.current) {
          const input = replacementInput.current
          input?.focus()
          input?.setSelectionRange(input.value.length, input.value.length)
        } else metadataOpener.current?.focus()
      }}
    />

    <Dialog open={modal === 'modifiers'} onOpenChange={open => !open && setModal(null)}>
      <DialogContent className="modifier-dialog" onCloseAutoFocus={event => {
        event.preventDefault()
        if (focusReplacement.current) {
          const input = replacementInput.current
          input?.focus()
          input?.setSelectionRange(input.value.length, input.value.length)
        } else metadataOpener.current?.focus()
      }}>
        <p className="eyebrow">A VALUE, YOUR WAY</p>
        <DialogTitle>Metadata & modifiers</DialogTitle>
        <DialogDescription>Format a value, combine transformations, and preview the result.</DialogDescription>
        <MetadataPatternBuilder file={plan.rows.find(row => row.status !== 'unmatched')?.file ?? files[0]} index={plan.matchedCount ? 1 : undefined} onInsert={token => {
          setReplacement(current => current + token)
          setActiveTemplate('Custom rule')
          focusReplacement.current = true
          setModal(null)
        }} />
      </DialogContent>
    </Dialog>

    <Dialog open={modal === 'templates'} onOpenChange={open => !open && setModal(null)}>
      <DialogContent className="templates-dialog" onCloseAutoFocus={event => { event.preventDefault(); templateOpener.current?.focus() }}>
        <TemplateLibrary savedTemplates={savedTemplates} onApply={applyTemplate} />
      </DialogContent>
    </Dialog>

    <Dialog open={modal === 'guide'} onOpenChange={open => !open && setModal(null)}><DialogContent className="guide-dialog"><p className="eyebrow">A QUICK FIELD GUIDE</p><DialogTitle>A little logic. A lot of order.</DialogTitle><DialogDescription>Open a folder, write a rule, and check the preview. Only the Rename button changes your files.</DialogDescription><div className="guide-steps"><p><b>01</b><span><strong>Find what matters.</strong> Your regular expression matches the filename, including its extension. Use parentheses to capture a part you want to keep.</span></p><p><b>02</b><span><strong>Make it your own.</strong> Use <code>$1</code> for the first capture, or add metadata with <code>{'{…}'}</code>. Type <code>{'{'}</code> for suggestions.</span></p><p><b>03</b><span><strong>Review, then rename.</strong> Uncheck files to exclude them. Conflicts and missing metadata are flagged before anything changes.</span></p></div><div className="guide-example"><code>^IMG_(\d+)\.jpg$</code><ArrowDown size={15} /><code>photo-$1.{'{ext}'}</code><p>IMG_1042.jpg <ArrowRight size={12} /> photo-1042.jpg</p></div><h3>The useful little details</h3><div className="guide-tokens">{TOKEN_DEFINITIONS.map(token => <div key={token.key}><code>{token.example}</code><span>{token.description}</span></div>)}</div><h3>Make metadata your own</h3><p className="guide-note">Chain modifiers with <code>|</code> in the order they should run: <code>{'{name|trim|lower|whitespace("-")}'}</code>. Text arguments use quotes. The Modifiers builder lets you preview and reorder each step.</p><div className="guide-tokens">{MODIFIER_DEFINITIONS.map(modifier => <div key={modifier.key}><code>{modifier.example}</code><span>{modifier.description}</span></div>)}</div><p className="guide-note">Plain filenames stay in their current folder. Paths with <code>/</code> start at your selected folder. Photo metadata comes from embedded EXIF; modification dates come from the filesystem. Desktop Chrome or Edge is needed for local folder access. Native rename support varies; copy & delete is available as an explicit alternative.</p></DialogContent></Dialog>

    <RenameConfirmationDialog open={modal === 'confirm'} onOpenChange={open => !open && setModal(null)}
      plan={plan} demo={demo} directoryName={directory?.name} method={method} onMethodChange={setMethod}
      canRename={canRename} onConfirm={() => void executeRename()} />

    <Dialog open={modal === 'save'} onOpenChange={open => !open && setModal(null)}><DialogContent><p className="eyebrow">KEEP A GOOD IDEA</p><DialogTitle>Save your naming rule.</DialogTitle><DialogDescription>Available in this browser, whenever you need it.</DialogDescription><form onSubmit={event => { event.preventDefault(); saveTemplate() }}><label className="save-label" htmlFor="template-name">Template name</label><input id="template-name" className="text-input" value={templateName} onChange={event => setTemplateName(event.target.value)} placeholder="e.g. Monthly studio archive" maxLength={80} /><div className="saved-pattern"><code>{pattern}</code><ArrowDown size={13} /><code>{replacement}</code></div><div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setModal(null)}>Cancel</Button><Button type="submit" disabled={!templateName.trim()}>Save template<Plus size={15} /></Button></div></form></DialogContent></Dialog>

    <ActivityDialog open={modal === 'history'} onOpenChange={open => !open && setModal(null)} history={history} onExport={downloadReceipt} />
  </div>
}

function FolderBar({ demo, directoryName, fileCount, totalSize, busy, onRefresh, onOpen }: {
  demo: boolean
  directoryName?: string
  fileCount: number
  totalSize: number
  busy: boolean
  onRefresh: () => void
  onOpen: () => void
}) {
  return <section className="folder-bar" aria-label="Selected folder">
        <div className="folder-symbol"><FolderOpen size={23} strokeWidth={1.5} /></div>
        <div className="folder-details"><div><h2>{demo ? 'Studio selects' : directoryName}</h2>{demo && <span className="demo-badge">DEMO FOLDER</span>}</div><p>{fileCount} files <span>·</span> {formatBytes(totalSize)} <span>·</span> {demo ? 'A few sample files to make yourself at home.' : 'Connected to your device'}</p></div>
        <div className="folder-actions">{!demo && <Button variant="ghost" size="icon" aria-label="Refresh folder" disabled={busy} onClick={onRefresh}><RotateCcw size={16} /></Button>}<Button variant="outline" disabled={busy} onClick={onOpen}>{busy ? <LoaderCircle className="spin" size={15} /> : <Folder size={15} />}Open folder<ArrowUpRight size={14} /></Button></div>
      </section>
}

function RenameAction({ plan, busy, progress, demo, canRename, onConfirm }: {
  plan: ReturnType<typeof buildRenamePlan>
  busy: boolean
  progress: string
  demo: boolean
  canRename: boolean
  onConfirm: () => void
}) {
  return <div className="rename-action"><div><span className="action-icon"><CheckCheck size={19} /></span><div><strong>{busy ? progress : plan.errorCount ? 'A few names need a second look.' : plan.readyCount ? `${plan.readyCount} files. Ready when you are.` : 'Your files are in good company.'}</strong><p>{demo ? 'Try it out. These are only sample files.' : 'Review the new names before applying changes.'}</p></div></div><Button disabled={!canRename} onClick={onConfirm}>{busy ? <LoaderCircle size={15} className="spin" /> : null}Rename {plan.readyCount} files<ArrowRight size={16} /></Button></div>
}

function NoticeToast({ notice, canUndo, onUndo, onDismiss }: {
  notice: { message: string; error?: boolean }
  canUndo: boolean
  onUndo: () => void
  onDismiss: () => void
}) {
  return <div className={`toast ${notice.error ? 'toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.error ? <CircleHelp size={18} /> : <Check size={18} />}</span><p>{notice.message}</p>{canUndo && !notice.error && <button onClick={onUndo}>Undo</button>}<button aria-label="Dismiss notification" onClick={onDismiss}><X size={16} /></button></div>
}

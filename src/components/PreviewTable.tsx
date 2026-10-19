import { useEffect, useMemo, useRef, useState, type RefObject, type Dispatch, type SetStateAction, type PointerEvent } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, Check, Columns3, File, FileImage, FileText, Info, ListFilter, RotateCcw, Search, X } from 'lucide-react'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { MatchedFilename } from './MatchedFilename'
import { HighlightedText } from './HighlightedText'
import { FileSearch } from './FileSearch'
import { compileFileSearch } from '@/lib/file-search'
import { buildPreviewRecords, DEFAULT_COLUMN_IDS, getPreviewColumns, selectPreviewRecords, type PreviewRecord, type PreviewColumn, type PreviewSort } from '@/lib/preview-table'
import type { FileEntry, RenamePlan } from '@/lib/rename'
import './preview-table.css'

const STORAGE_KEY = 'renameotron.preview-columns'
const MIN_WIDTH = 96
const MAX_WIDTH = 800
type ColumnSettings = { ids: string[]; widths: Record<string, number>; sort: PreviewSort | null }
const defaults = (): ColumnSettings => ({ ids: [...DEFAULT_COLUMN_IDS], widths: {}, sort: null })
const clampWidth = (width: number) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)))

function readSettings(): ColumnSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<ColumnSettings> | null
    if (!saved || !Array.isArray(saved.ids)) return defaults()
    const knownIds = new Set(getPreviewColumns([]).map(column => column.id))
    const validId = (id: unknown): id is string => typeof id === 'string' && (knownIds.has(id) || (id.startsWith('metadata:') && id.length > 9 && id.length < 256))
    const ids = [...new Set(saved.ids.filter(validId))]
    if (!ids.length) return defaults()
    const widths: Record<string, number> = {}
    if (saved.widths && typeof saved.widths === 'object') {
      for (const [id, width] of Object.entries(saved.widths)) {
        if (validId(id) && typeof width === 'number' && Number.isFinite(width)) widths[id] = clampWidth(width)
      }
    }
    const sort = saved.sort && ids.includes(saved.sort.columnId) && ['asc', 'desc'].includes(saved.sort.direction) ? saved.sort : null
    return { ids, widths, sort }
  } catch { return defaults() }
}

interface PreviewTableProps {
  files: FileEntry[]
  plan: RenamePlan
  selectedIds: Set<string>
  onToggleFile: (id: string) => void
  onSelectFiles: (ids: string[], selected: boolean) => void
  onInspect: (file: FileEntry, opener: HTMLButtonElement | null) => void
  highlightRegex: RegExp | null
  search: string
  onSearchChange: (value: string) => void
  filter: 'all' | 'matched'
  onFilterChange: (value: 'all' | 'matched') => void
  filters: Record<string, string>
  setFilters: Dispatch<SetStateAction<Record<string, string>>>
  onColumnsOpenChange: (open: boolean) => void
}

export function PreviewTable({ files, plan, selectedIds, onToggleFile, onSelectFiles, onInspect, highlightRegex, search, onSearchChange, filter, onFilterChange, filters, setFilters, onColumnsOpenChange }: PreviewTableProps) {
  const [settings, setSettings] = useState<ColumnSettings>(readSettings)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [columnSearch, setColumnSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const columnsButton = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ id: string; x: number; width: number } | null>(null)
  const catalog = useMemo(() => getPreviewColumns(files), [files])
  const columns = useMemo(() => {
    const selected = settings.ids.flatMap(id => catalog.find(column => column.id === id) ?? [])
    return selected.length ? selected : catalog.filter(column => DEFAULT_COLUMN_IDS.includes(column.id))
  }, [catalog, settings.ids])
  const records = useMemo(() => buildPreviewRecords(plan.rows, selectedIds), [plan.rows, selectedIds])
  const activeFilters = useMemo(() => Object.fromEntries(columns.flatMap(column => filters[column.id]?.trim() ? [[column.id, filters[column.id]]] : [])), [columns, filters])
  const sort = columns.some(column => column.id === settings.sort?.columnId) ? settings.sort : null
  const searchQuery = useMemo(() => compileFileSearch(search), [search])
  const visible = useMemo(() => selectPreviewRecords(records, { search, filters: activeFilters, sort, matchedOnly: filter === 'matched' }, searchQuery), [records, search, searchQuery, activeFilters, sort, filter])
  const selectedVisible = visible.filter(record => selectedIds.has(record.row.file.id)).length
  const filterCount = Object.keys(activeFilters).length
  const hasSearch = !!search.trim() || filterCount > 0
  const columnWidth = (column: PreviewColumn) => settings.widths[column.id] ?? column.width

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)) } catch { /* The table still works when storage is unavailable. */ }
  }, [settings])

  function openColumns(open: boolean) {
    setColumnsOpen(open)
    onColumnsOpenChange(open)
    if (open) setColumnSearch('')
  }

  function toggleColumn(columnId: string) {
    const ids = columns.map(column => column.id)
    if (ids.includes(columnId) && ids.length === 1) return
    const removing = ids.includes(columnId)
    setSettings(current => ({ ...current, ids: removing ? ids.filter(id => id !== columnId) : [...ids, columnId], sort: removing && current.sort?.columnId === columnId ? null : current.sort }))
    if (removing) setFilters(current => { const next = { ...current }; delete next[columnId]; return next })
  }

  function moveColumn(columnId: string, direction: number) {
    const ids = columns.map(column => column.id)
    const index = ids.indexOf(columnId)
    const target = index + direction
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    setSettings(current => ({ ...current, ids }))
  }

  function resizeColumn(id: string, width: number) {
    setSettings(current => ({ ...current, widths: { ...current.widths, [id]: clampWidth(width) } }))
  }

  function startResize(event: PointerEvent<HTMLDivElement>, column: PreviewColumn) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { id: column.id, x: event.clientX, width: columnWidth(column) }
  }

  function clearFilters() { onSearchChange(''); setFilters({}); onFilterChange('all') }

  return <>
    <PreviewToolbar filter={filter} onFilterChange={onFilterChange} fileCount={files.length} matchedCount={plan.matchedCount}
      search={search} onSearchChange={onSearchChange} searchError={searchQuery.error} hasSearch={hasSearch} visibleCount={visible.length}
      showFilters={showFilters} setShowFilters={setShowFilters} filterCount={filterCount} columnsButton={columnsButton}
      openColumns={openColumns} columns={columns} activeFilters={activeFilters} setFilters={setFilters} clearFilters={clearFilters} />
    <div className="file-table-scroll" role="region" aria-label="File rename preview" tabIndex={0}>
      <table className="file-table preview-table" style={{ minWidth: columns.reduce((total, column) => total + columnWidth(column), 80) }}>
        <colgroup><col style={{ width: 44 }} />{columns.map(column => <col key={column.id} style={{ width: columnWidth(column) }} />)}<col style={{ width: 36 }} /><col /></colgroup>
        <thead><tr>
          <th className="check-cell"><Checkbox aria-label={visible.length === files.length ? 'Select all files' : 'Select all visible files'} checked={visible.length > 0 && selectedVisible === visible.length ? true : selectedVisible ? 'indeterminate' : false} disabled={!visible.length} onCheckedChange={checked => onSelectFiles(visible.map(record => record.row.file.id), !!checked)} /></th>
          {columns.map(column => <th key={column.id} scope="col" data-column-id={column.id} aria-sort={sort?.columnId === column.id ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
            <button className="column-sort" aria-label={`Sort by ${column.label}`} title={`${column.description} Click to sort; click again to reverse or reset.`} onClick={() => setSettings(current => ({ ...current, sort: current.sort?.columnId !== column.id ? { columnId: column.id, direction: 'asc' } : current.sort.direction === 'asc' ? { columnId: column.id, direction: 'desc' } : null }))}><span>{column.label}</span>{sort?.columnId === column.id ? sort.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowUpDown size={12} />}</button>
            {showFilters && <div className="column-filter"><input aria-label={`Filter ${column.label}`} placeholder="Contains…" value={filters[column.id] ?? ''} onChange={event => setFilters(current => ({ ...current, [column.id]: event.target.value }))} />{filters[column.id] && <button aria-label={`Clear ${column.label} filter`} onClick={() => setFilters(current => ({ ...current, [column.id]: '' }))}><X size={11} /></button>}</div>}
            <div className="column-resize" role="separator" tabIndex={0} aria-label={`Resize ${column.label} column`} aria-orientation="vertical" aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={columnWidth(column)} aria-valuetext={`${columnWidth(column)} pixels`} title="Drag to resize. Double-click to reset. Arrow keys also resize."
              onPointerDown={event => startResize(event, column)}
              onPointerMove={event => { if (drag.current?.id === column.id) resizeColumn(column.id, drag.current.width + event.clientX - drag.current.x) }}
              onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
              onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
              onDoubleClick={() => resizeColumn(column.id, column.width)}
              onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const step = event.shiftKey ? 64 : 16
                resizeColumn(column.id, event.key === 'Home' ? MIN_WIDTH : event.key === 'End' ? MAX_WIDTH : columnWidth(column) + (event.key === 'ArrowRight' ? step : -step))
              }} />
          </th>)}
          <th className="status-cell"><span className="sr-only">File status</span></th><th aria-hidden="true" />
        </tr></thead>
        <tbody>{visible.map(record => <PreviewRow key={record.row.file.id} record={record} columns={columns}
          selected={selectedIds.has(record.row.file.id)} onToggleFile={onToggleFile} onInspect={onInspect} highlightRegex={highlightRegex} />)}</tbody>
      </table>
      {visible.length === 0 && <PreviewEmptyState fileCount={files.length} searchError={!!searchQuery.error} hasFilters={hasSearch || filter === 'matched'} onClear={clearFilters} />}
    </div>
    <Dialog open={columnsOpen} onOpenChange={openColumns}>
      <DialogContent className="columns-dialog" onCloseAutoFocus={event => { event.preventDefault(); columnsButton.current?.focus() }}>
        <p className="eyebrow">MAKE ROOM FOR THE DETAILS</p><DialogTitle>Manage columns</DialogTitle>
        <DialogDescription>Choose the details you want to see. Drag a header edge to resize; click a heading to sort. Your layout is saved in this browser.</DialogDescription>
        <div className="columns-dialog-body">
        <div className="selected-columns-heading"><h3>Visible columns <span>{columns.length}</span></h3><button className="preview-clear" onClick={() => { setSettings(defaults()); setFilters({}) }}><RotateCcw size={12} />Reset columns</button></div>
        <ol className="selected-columns">{columns.map((column, index) => <li key={column.id}><span className="column-position">{String(index + 1).padStart(2, '0')}</span><span>{column.label}</span><div><button aria-label={`Move ${column.label} left`} title="Move left" disabled={index === 0} onClick={() => moveColumn(column.id, -1)}><ArrowLeft size={13} /></button><button aria-label={`Move ${column.label} right`} title="Move right" disabled={index === columns.length - 1} onClick={() => moveColumn(column.id, 1)}><ArrowRight size={13} /></button><button aria-label={`Remove ${column.label} column`} title="Remove column" disabled={columns.length === 1} onClick={() => toggleColumn(column.id)}><X size={14} /></button></div></li>)}</ol>
        <div className="column-catalog-search"><Search size={14} /><input aria-label="Find columns" placeholder="Find a column or metadata field…" value={columnSearch} onChange={event => setColumnSearch(event.target.value)} /></div>
        <div className="column-catalog">{[...new Set(catalog.map(column => column.group))].map(group => {
          const matching = catalog.filter(column => column.group === group && `${column.label} ${column.description} ${column.id}`.toLowerCase().includes(columnSearch.toLowerCase().trim()))
          return matching.length > 0 && <section key={group}><h3>{group}</h3>{matching.map(column => <label key={column.id} title={column.description}><Checkbox aria-label={`Show ${column.label} column`} checked={columns.some(visibleColumn => visibleColumn.id === column.id)} disabled={columns.length === 1 && columns[0].id === column.id} onCheckedChange={() => toggleColumn(column.id)} /><span>{column.label}</span></label>)}</section>
        })}{!catalog.some(column => `${column.label} ${column.description} ${column.id}`.toLowerCase().includes(columnSearch.toLowerCase().trim())) && <p>No columns match your search.</p>}</div>
        <p className="columns-dialog-note">All available metadata can be searched, even when its column is hidden. Missing values appear as —.</p>
        </div>
        <div className="columns-dialog-actions"><Button onClick={() => openColumns(false)}>Done</Button></div>
      </DialogContent>
    </Dialog>
  </>
}

interface PreviewRowProps {
  record: PreviewRecord
  columns: PreviewColumn[]
  selected: boolean
  onToggleFile: PreviewTableProps['onToggleFile']
  onInspect: PreviewTableProps['onInspect']
  highlightRegex: RegExp | null
}

function PreviewRow({ record: { row, values }, columns, selected, onToggleFile, onInspect, highlightRegex }: PreviewRowProps) {
  const Icon = row.file.type.startsWith('image/') ? FileImage : row.file.type.includes('text') || row.file.type === 'application/pdf' ? FileText : File
  return <tr className={`file-row ${row.status === 'unmatched' ? 'unmatched-row' : ''} ${row.status === 'error' ? 'error-row' : ''}`} tabIndex={0} onKeyDown={event => {
    if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return
    event.preventDefault()
    onInspect(row.file, event.currentTarget.querySelector<HTMLButtonElement>('[data-metadata-opener]'))
  }} onClick={event => onInspect(row.file, event.currentTarget.querySelector<HTMLButtonElement>('[data-metadata-opener]'))}>
    <td className="check-cell" onClick={event => event.stopPropagation()}><Checkbox aria-label={`Select ${row.file.name}`} checked={selected} onCheckedChange={() => onToggleFile(row.file.id)} /></td>
    {columns.map(column => <td key={column.id} className={`preview-data-cell ${column.id === 'size' ? 'preview-size-cell' : ''}`}>
      {column.id === 'from' ? <button type="button" className="filename-cell" data-metadata-opener aria-label={`View metadata for ${row.file.path}`} aria-haspopup="dialog" title="View file metadata and name patterns" onClick={event => { event.stopPropagation(); onInspect(row.file, event.currentTarget) }}><span className={`file-icon ${row.file.type.startsWith('image/') ? 'is-image' : ''}`}><Icon size={17} strokeWidth={1.5} /></span><MatchedFilename file={row.file} regex={highlightRegex} enabled={row.status !== 'unmatched'} /></button>
        : column.id === 'to' ? <><span className={`target-name ${row.status === 'ready' ? 'will-rename' : ''}`} title={row.error ?? row.targetPath}>{row.status === 'unmatched' ? <span className="no-match">{selected ? 'No match' : 'Excluded'}</span> : <HighlightedText text={row.targetPath} spans={row.targetHighlights ?? []} />}</span>{row.status === 'error' && <small className="row-error">{row.error}</small>}</>
          : <span className={`preview-cell-value ${values[column.id]?.sortValue === null ? 'unavailable-value' : ''}`} title={values[column.id]?.searchText ?? values[column.id]?.text}>{values[column.id]?.text ?? '—'}</span>}
    </td>)}
    <PreviewRowStatus row={row} values={values} hasFilename={columns.some(column => column.id === 'from')} onInspect={onInspect} /><td aria-hidden="true" />
  </tr>
}

function PreviewEmptyState({ fileCount, searchError, hasFilters, onClear }: { fileCount: number; searchError: boolean; hasFilters: boolean; onClear: () => void }) {
  const title = searchError ? 'Finish your search.' : fileCount === 0 ? 'A clean slate.' : 'No files in this view.'
  const hint = searchError ? 'Check the search hint above to continue filtering.' : fileCount === 0 ? 'Open a folder with a few files to get started.' : 'Try different filters or clear your search.'
  return <div className="empty-state"><Search size={25} /><h3>{title}</h3><p>{hint}</p>{hasFilters && <Button variant="outline" size="sm" onClick={onClear}>Show all files</Button>}</div>
}

interface PreviewToolbarProps extends Pick<PreviewTableProps, 'filter' | 'onFilterChange' | 'search' | 'onSearchChange' | 'setFilters'> {
  fileCount: number
  matchedCount: number
  visibleCount: number
  searchError?: { message: string; position: number }
  hasSearch: boolean
  showFilters: boolean
  setShowFilters: Dispatch<SetStateAction<boolean>>
  filterCount: number
  columnsButton: RefObject<HTMLButtonElement | null>
  openColumns: (open: boolean) => void
  columns: PreviewColumn[]
  activeFilters: Record<string, string>
  clearFilters: () => void
}

function PreviewToolbar({ filter, onFilterChange, fileCount, matchedCount, search, onSearchChange, searchError, hasSearch, visibleCount,
  showFilters, setShowFilters, filterCount, columnsButton, openColumns, columns, activeFilters, setFilters, clearFilters }: PreviewToolbarProps) {
  return <div className="preview-toolbar preview-table-toolbar">
      <div className="preview-controls">
        <div className="view-tabs" role="group" aria-label="Filter files">
          <button className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => onFilterChange('all')}>All files<span>{fileCount}</span></button>
          <button className={filter === 'matched' ? 'active' : ''} aria-pressed={filter === 'matched'} onClick={() => onFilterChange('matched')}>Matched<span>{matchedCount}</span></button>
        </div>
        <FileSearch value={search} onChange={onSearchChange} error={searchError}
          resultCount={hasSearch || filter === 'matched' ? `${visibleCount} of ${fileCount}` : `${fileCount} files`} />
        <div className="preview-view-actions">
          <button className="preview-tool-button" aria-label="Column filters" aria-pressed={showFilters} title="Search within individual columns" onClick={() => setShowFilters(current => !current)}><ListFilter size={14} /><span>Filters</span>{filterCount > 0 && <b>{filterCount}</b>}</button>
          <button ref={columnsButton} className="preview-tool-button" aria-label="Columns" title="Manage columns" aria-haspopup="dialog" onClick={() => openColumns(true)}><Columns3 size={14} /><span>Columns</span></button>
        </div>
      </div>
      {(showFilters || hasSearch || filter === 'matched') && <div className="preview-filter-summary">
        {showFilters && <p className="column-filter-hint">Filter columns below. Files must match every filter.</p>}
        {!showFilters && filterCount > 0 && <div className="active-column-filters">{columns.filter(column => activeFilters[column.id]).map(column => <button key={column.id} title={`Clear ${column.label} filter`} aria-label={`Clear ${column.label} filter`} onClick={() => setFilters(current => { const next = { ...current }; delete next[column.id]; return next })}><span>{column.label}: {activeFilters[column.id]}</span><X size={12} /></button>)}</div>}
        {(hasSearch || filter === 'matched') && <button className="preview-clear" onClick={clearFilters}><RotateCcw size={12} />Clear filters</button>}
      </div>}
    </div>
}

function PreviewRowStatus({ row, values, hasFilename, onInspect }: PreviewRecord & {
  hasFilename: boolean
  onInspect: PreviewTableProps['onInspect']
}) {
  return <td className="status-cell">{!hasFilename ? <button className="preview-inspect" data-metadata-opener aria-label={`View metadata for ${row.file.path}`} aria-haspopup="dialog" title={row.error ?? values.status.text} onClick={event => { event.stopPropagation(); onInspect(row.file, event.currentTarget) }}>{row.status === 'error' ? <span className="error-mark">!</span> : <Info size={14} />}</button> : row.status === 'ready' ? <span className="ready-dot" title="Ready to rename" /> : row.status === 'error' ? <span className="error-mark" title={row.error}>!</span> : row.status === 'unchanged' ? <Check size={12} /> : null}</td>
}

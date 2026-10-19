import { useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { ArrowLeft, Plus, SlidersHorizontal } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { getFileTokenDetails, type FileEntry } from '@/lib/rename'
import { MetadataPatternBuilder } from './MetadataPatternBuilder'
import './file-metadata-dialog.css'

const sections = [
  { title: 'File details', keys: ['name', 'ext', 'size', 'type', 'modified'] },
  { title: 'Photo metadata', keys: ['taken', 'camera', 'width', 'height'] },
  { title: 'Calculated image details', keys: ['dimensions', 'aspect', 'megapixels', 'orientation'] },
  { title: 'Generated values', keys: ['index', 'uuid'] },
]

interface FileMetadataDialogProps {
  file?: FileEntry
  index?: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onInsert: (token: string) => void
  onCloseAutoFocus: ComponentProps<typeof DialogContent>['onCloseAutoFocus']
}

export function FileMetadataDialog({ file, index, open, onOpenChange, onInsert, onCloseAutoFocus }: FileMetadataDialogProps) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="file-metadata-dialog" onCloseAutoFocus={onCloseAutoFocus}>
      <FileMetadataContent key={file?.id} file={file} index={index} onInsert={onInsert} />
    </DialogContent>
  </Dialog>
}

function FileMetadataContent({ file, index, onInsert }: Pick<FileMetadataDialogProps, 'file' | 'index' | 'onInsert'>) {
  const tokens = useMemo(() => file ? getFileTokenDetails(file, index) : [], [file, index])
  const [customizedToken, setCustomizedToken] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const returnToken = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (customizedToken && scrollRef.current) {
      scrollRef.current.scrollTop = 0
      scrollRef.current.querySelector('select')?.focus()
    } else if (returnToken.current) {
      scrollRef.current?.querySelector<HTMLButtonElement>(`[data-customize-token="${returnToken.current}"]`)?.focus()
      returnToken.current = null
    }
  }, [customizedToken])

  return <>
    <p className="eyebrow">A CLOSER LOOK</p>
    <DialogTitle>File metadata</DialogTitle>
    <p className="metadata-file-path">{file?.path}</p>
    <DialogDescription>{customizedToken ? 'Shape a metadata value with modifiers, then insert the finished token.' : 'Click a token to insert it, or use its modifier button to format and combine transformations.'}</DialogDescription>
    <div ref={scrollRef} className="metadata-scroll" tabIndex={0} role="region" aria-label="Metadata and name patterns">
      {customizedToken ? <><button type="button" className="metadata-back" onClick={() => { returnToken.current = customizedToken; setCustomizedToken(null) }}><ArrowLeft size={14} />All metadata</button><MetadataPatternBuilder key={customizedToken} initialToken={customizedToken} file={file} index={index} onInsert={onInsert} /></> : <table className="metadata-table">
        <thead><tr><th scope="col">Metadata</th><th scope="col">Value</th><th scope="col">Name pattern</th></tr></thead>
        {sections.map(section => <tbody key={section.title}>
          <tr className="metadata-section"><th colSpan={3} scope="rowgroup">{section.title}</th></tr>
          {section.keys.map(key => {
            const token = tokens.find(candidate => candidate.key === key)
            if (!token) return null
            const available = token.value !== undefined
            return <tr key={key} className={available ? '' : 'metadata-unavailable'}>
              <th scope="row" title={token.description}>{token.label}{key === 'size' && <small>bytes</small>}{(key === 'width' || key === 'height') && <small>pixels</small>}</th>
              <td className="metadata-value">{available ? token.displayValue || 'No extension' : <span title={token.error}>Not available</span>}{key === 'index' && !available && <small>{token.error}</small>}</td>
              <td className="metadata-pattern"><div className="metadata-pattern-actions"><button
                type="button"
                className={`metadata-insert hl-token-${key}`}
                aria-label={`Insert ${token.example}`}
                disabled={!available}
                title={available ? `Add ${token.example} to your name pattern. ${token.description}` : token.error}
                onClick={() => onInsert(token.example)}
              ><code>{token.example}</code><Plus size={13} aria-hidden="true" /></button><button type="button" className="metadata-customize" data-customize-token={key} aria-label={`Customize ${token.label}`} title="Add modifiers" onClick={() => setCustomizedToken(key)}><SlidersHorizontal size={13} /></button></div>{available && token.displayValue !== token.value && <small>Produces <code>{token.value}</code></small>}</td>
            </tr>
          })}
        </tbody>)}
      </table>}
    </div>
    <div className="metadata-notes">
      <p>Dates use UTC. Customize with <code>YYYY</code>, <code>MM</code>, <code>DD</code>, <code>HH</code>, <code>mm</code>, and <code>ss</code>.</p>
      <p>Chain modifiers with <code>|</code>, for example <code>{'{name|trim|lower|whitespace("-")}'}</code>.</p>
      <p>Missing metadata may be absent from the file or unsupported. Tokens apply to all selected matches; <code>/</code> in a value creates subfolders.</p>
    </div>
  </>
}

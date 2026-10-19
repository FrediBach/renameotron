import { useMemo, type ComponentProps } from 'react'
import { Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { getFileTokenDetails, type FileEntry } from '@/lib/rename'
import './file-metadata-dialog.css'

const sections = [
  { title: 'File details', keys: ['name', 'ext', 'size', 'type', 'modified'] },
  { title: 'Photo metadata', keys: ['taken', 'camera', 'width', 'height'] },
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
  const tokens = useMemo(() => file ? getFileTokenDetails(file, index) : [], [file, index])

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="file-metadata-dialog" onCloseAutoFocus={onCloseAutoFocus}>
      <p className="eyebrow">A CLOSER LOOK</p>
      <DialogTitle>File metadata</DialogTitle>
      <p className="metadata-file-path">{file?.path}</p>
      <DialogDescription>Metadata available to renameotron. Click a token to add it to the end of your name pattern.</DialogDescription>
      <div className="metadata-scroll" tabIndex={0} role="region" aria-label="Metadata and name patterns">
        <table className="metadata-table">
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
                <td className="metadata-pattern"><button
                  type="button"
                  className={`metadata-insert hl-token-${key}`}
                  aria-label={`Insert ${token.example}`}
                  disabled={!available}
                  title={available ? `Add ${token.example} to your name pattern. ${token.description}` : token.error}
                  onClick={() => onInsert(token.example)}
                ><code>{token.example}</code><Plus size={13} aria-hidden="true" /></button>{available && token.displayValue !== token.value && <small>Produces <code>{token.value}</code></small>}</td>
              </tr>
            })}
          </tbody>)}
        </table>
      </div>
      <div className="metadata-notes">
        <p>Dates use UTC. Customize with <code>YYYY</code>, <code>MM</code>, <code>DD</code>, <code>HH</code>, <code>mm</code>, and <code>ss</code>.</p>
        <p>Missing metadata may be absent from the file or unsupported. Tokens apply to all selected matches; <code>/</code> in a value creates subfolders.</p>
      </div>
    </DialogContent>
  </Dialog>
}

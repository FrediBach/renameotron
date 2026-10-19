import { Check, Copy, History, X } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import type { SavedRun } from '@/lib/activity'

interface ActivityDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  history: SavedRun[]
  onExport: () => void
}

export function ActivityDialog({ open, onOpenChange, history, onExport }: ActivityDialogProps) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="history-dialog"><p className="eyebrow">A RECORD OF THE LITTLE THINGS</p><DialogTitle>Your activity.</DialogTitle><DialogDescription>Rename results from this session, one file at a time.</DialogDescription>{history.length === 0 ? <div className="empty-state"><History size={27} /><h3>A fresh start.</h3><p>Your completed renames will appear here.</p></div> : <><div className="history-list">{history.map(run => <section key={run.id}><h3>{run.results.filter(result => result.success).length} files renamed <span>{run.demo ? 'Demo · ' : ''}{run.at}</span></h3>{run.results.map(result => <div className={result.success ? '' : 'error-text'} key={result.source}><span>{result.success ? <Check size={13} /> : <X size={13} />}</span><p><span>{result.source}</span><strong>{result.destination}</strong>{result.error && <small>{result.error}</small>}</p></div>)}</section>)}</div><div className="dialog-actions"><Button variant="outline" onClick={onExport}><Copy size={14} />Export receipt</Button></div></>}</DialogContent></Dialog>
}

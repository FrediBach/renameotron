import { ArrowRight, FolderOpen } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import type { RenamePlan } from '@/lib/rename'

interface RenameConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: RenamePlan
  demo: boolean
  directoryName?: string
  method: 'native' | 'copy'
  onMethodChange: (method: 'native' | 'copy') => void
  canRename: boolean
  onConfirm: () => void
}

export function RenameConfirmationDialog({ open, onOpenChange, plan, demo, directoryName, method, onMethodChange, canRename, onConfirm }: RenameConfirmationDialogProps) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="confirm-dialog"><span className="modal-symbol"><FolderOpen size={26} strokeWidth={1.5} /></span><DialogTitle>A new name for {plan.readyCount} files.</DialogTitle><DialogDescription>{demo ? 'This is a practice run with sample files. Your device’s files won’t be changed.' : `Apply the previewed names in “${directoryName}”. New subfolders will be created where needed.`}</DialogDescription><div className="confirmation-preview">{plan.rows.filter(row => row.status === 'ready').slice(0, 3).map(row => <div key={row.file.id}><span>{row.file.path}</span><ArrowRight size={13} /><strong>{row.targetPath}</strong></div>)}{plan.readyCount > 3 && <p>and {plan.readyCount - 3} more files</p>}</div>{!demo && <><fieldset className="method-choice"><legend>Rename method</legend><label><input type="radio" name="rename-method" checked={method === 'native'} onChange={() => onMethodChange('native')} /><span><strong>Native rename</strong><small>Fast, without copying. Requires browser support.</small></span></label><label><input type="radio" name="rename-method" checked={method === 'copy'} onChange={() => onMethodChange('copy')} /><span><strong>Copy & delete</strong><small>Copies each file, checks its size, then removes the original. Needs extra disk space; filesystem timestamps may change.</small></span></label></fieldset><p className="confirm-note">Batches can partially complete. Existing names are never intentionally overwritten. There is no automatic undo for local files; an activity receipt records every attempted change.</p></>}<div className="dialog-actions"><Button variant="outline" onClick={() => onOpenChange(false)}>Keep editing</Button><Button onClick={() => void onConfirm()} disabled={!canRename}>{demo ? 'Try the rename' : `Rename ${plan.readyCount} files`}<ArrowRight size={15} /></Button></div></DialogContent></Dialog>
}

import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { createShareUrl, type PatternSetup } from '@/lib/share'

export function ShareRuleButton({ setup, open, onOpenChange, onCopied }: {
  setup: PatternSetup
  open: boolean
  onOpenChange: (open: boolean) => void
  onCopied: () => void
}) {
  const opener = useRef<HTMLButtonElement | null>(null)
  const [shareUrl, setShareUrl] = useState('')

  async function share() {
    const url = createShareUrl(window.location.href, setup)
    try {
      await navigator.clipboard.writeText(url)
      onCopied()
    } catch {
      setShareUrl(url)
      onOpenChange(true)
    }
  }

  return <>
    <Button ref={opener} variant="ghost" onClick={() => void share()} title="Copy a link to this pattern setup"><Plus size={14} />Share</Button>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus() }}>
        <p className="eyebrow">PASS IT ON</p>
        <DialogTitle>Share your naming rule.</DialogTitle>
        <DialogDescription>Automatic copying is unavailable. Copy this link to share your current pattern setup.</DialogDescription>
        <label className="save-label" htmlFor="share-url">Shareable link</label>
        <input id="share-url" className="text-input" value={shareUrl} readOnly onFocus={event => event.currentTarget.select()} />
        <div className="dialog-actions"><Button onClick={() => onOpenChange(false)}>Done</Button></div>
      </DialogContent>
    </Dialog>
  </>
}

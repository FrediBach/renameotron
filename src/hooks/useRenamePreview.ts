import { useMemo } from 'react'
import { compileHighlightRegex } from '@/lib/match-highlights'
import { tokenizeRegex } from '@/lib/pattern-highlights'
import { buildRenamePlan, type FileEntry } from '@/lib/rename'

interface RenamePreviewOptions {
  files: FileEntry[]
  pattern: string
  replacement: string
  flags: string
  selectedIds: Set<string>
  inspectedFileId: string | null
  busy: boolean
}

export function useRenamePreview({ files, pattern, replacement, flags, selectedIds, inspectedFileId, busy }: RenamePreviewOptions) {
  const plan = useMemo(() => buildRenamePlan(files, pattern, replacement, flags, selectedIds), [files, pattern, replacement, flags, selectedIds])
  const highlightRegex = useMemo(() => compileHighlightRegex(pattern, flags), [pattern, flags])
  const captureGroups = useMemo(() => tokenizeRegex(pattern).groups, [pattern])
  const inspectedFile = files.find(file => file.id === inspectedFileId)
  const inspectedIndex = plan.rows.filter(row => row.status !== 'unmatched').findIndex(row => row.file.id === inspectedFileId) + 1
  const totalSize = files.reduce((size, file) => size + file.size, 0)
  const canRename = plan.readyCount > 0 && plan.errorCount === 0 && !plan.error && !plan.replacementError && !busy
  return { plan, highlightRegex, captureGroups, inspectedFile, inspectedIndex, totalSize, canRename }
}

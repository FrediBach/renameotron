import { useMemo } from 'react'
import type { FileEntry } from '@/lib/rename'
import { getMatchHighlights } from '@/lib/match-highlights'
import { HighlightedText } from './HighlightedText'

export function MatchedFilename({ file, regex, enabled }: { file: FileEntry; regex: RegExp | null; enabled: boolean }) {
  const spans = useMemo(() => enabled ? getMatchHighlights(file.name, regex) : [], [file.name, regex, enabled])
  const parent = file.path.slice(0, file.path.length - file.name.length)
  return <span className="source-filename" title={file.path}>{parent}<HighlightedText text={file.name} spans={spans} /></span>
}

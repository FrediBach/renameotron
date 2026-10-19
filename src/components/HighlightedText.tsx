import type { ReactNode } from 'react'
import type { HighlightSpan } from '@/lib/highlight-types'
import './regex-highlights.css'

export function HighlightedText({ text, spans }: { text: string; spans: HighlightSpan[] }) {
  const content: ReactNode[] = []
  let cursor = 0
  for (const span of spans) {
    if (span.start > cursor) content.push(text.slice(cursor, span.start))
    const groupClass = span.group === undefined ? '' : ` hl-group-${(span.group - 1) % 6 + 1}`
    const tokenClass = span.token === undefined ? '' : ` hl-token-${span.token}`
    content.push(<mark key={`${span.start}-${span.end}`} className={`regex-highlight hl-${span.kind}${groupClass}${tokenClass}`} data-capture-group={span.group} data-metadata-token={span.token} title={span.label}>{text.slice(span.start, span.end)}</mark>)
    cursor = span.end
  }
  if (cursor < text.length) content.push(text.slice(cursor))
  return <>{content}</>
}

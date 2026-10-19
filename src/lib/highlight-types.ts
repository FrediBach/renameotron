export type HighlightKind = 'plain' | 'match' | 'syntax' | 'escape' | 'group' | 'metadata'

/** UTF-16 offsets, matching JavaScript strings and RegExp match indices. */
export interface HighlightSpan {
  start: number
  end: number
  kind: HighlightKind
  group?: number
  label?: string
}

export interface CaptureGroup {
  index: number
  name?: string
}

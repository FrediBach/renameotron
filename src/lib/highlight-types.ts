export type HighlightKind = 'plain' | 'match' | 'syntax' | 'escape' | 'group' | 'metadata'

/** UTF-16 offsets, matching JavaScript strings and RegExp match indices. */
export interface HighlightSpan {
  start: number
  end: number
  kind: HighlightKind
  group?: number
  token?: string
  label?: string
}

/** Stable metadata identities keep the editor and generated values in sync. */
export function metadataHighlight(key: string): Omit<HighlightSpan, 'start' | 'end'> {
  return { kind: 'metadata', token: key, label: `Metadata: ${key}` }
}

export interface CaptureGroup {
  index: number
  name?: string
}

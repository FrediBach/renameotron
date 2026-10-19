export type PatternSetup = {
  pattern: string
  replacement: string
  flags: string
  recursive: boolean
}

export function createShareUrl(baseUrl: string, setup: PatternSetup): string {
  const url = new URL(baseUrl)
  url.search = ''
  // Keep the naming rule in the fragment so it stays in the browser.
  url.hash = new URLSearchParams({
    v: '1',
    pattern: setup.pattern,
    replacement: setup.replacement,
    flags: setup.flags,
    recursive: setup.recursive ? '1' : '0',
  }).toString()
  return url.href
}

export function readSharedSetup(hash: string): PatternSetup | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const pattern = params.get('pattern')
  const replacement = params.get('replacement')
  const flags = params.get('flags')
  const recursive = params.get('recursive')
  if (params.get('v') !== '1' || pattern === null || replacement === null || flags === null
    || !['', 'g', 'i', 'gi'].includes(flags) || (recursive !== '0' && recursive !== '1')) return null
  return { pattern, replacement, flags, recursive: recursive === '1' }
}

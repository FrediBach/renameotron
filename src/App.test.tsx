// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { MetadataPatternBuilder } from './components/MetadataPatternBuilder'
import { createDemoFiles } from './lib/demo'
import * as filesystem from './lib/filesystem'

beforeEach(() => {
  // Keep browser persistence isolated from Node 25's process-level storage.
  const values = new Map<string, string>()
  const storage: Storage = {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => Array.from(values.keys())[index] ?? null,
    removeItem: key => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
  vi.stubGlobal('localStorage', storage)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fileRow(name: string) {
  const row = screen.getByRole('checkbox', { name: `Select ${name}` }).closest('tr')
  if (!row) throw new Error(`No preview row found for ${name}`)
  return within(row)
}

function replacementInput() {
  return screen.getByRole<HTMLInputElement>('combobox', { name: 'Give it a new name' })
}

function sourceFilename(name: string, path = name) {
  const row = screen.getByRole('checkbox', { name: `Select ${name}` }).closest('tr')
  const source = row?.querySelector<HTMLElement>('.filename-cell > span[title]')
  if (!source || source.title !== path) throw new Error(`No source filename found for ${path}`)
  return source
}

function targetFilename(name: string) {
  const row = screen.getByRole('checkbox', { name: `Select ${name}` }).closest('tr')
  const target = row?.querySelector<HTMLElement>('.target-name')
  if (!target) throw new Error(`No target filename found for ${name}`)
  return target
}

function patternHighlight(input: HTMLElement) {
  const highlight = input.parentElement?.querySelector('.pattern-highlight')
  if (!highlight) throw new Error('No syntax highlighting found for pattern input')
  return highlight
}

async function replaceInput(user: ReturnType<typeof userEvent.setup>, input: HTMLElement, value: string) {
  await user.clear(input)
  await user.paste(value)
}

describe('renameotron workspace', () => {
  it('opens metadata from the whole row without changing the rename selection', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(targetFilename('IMG_1042.jpg'))
    const dialog = screen.getByRole('dialog', { name: 'File metadata' })
    expect(within(dialog).getByText('IMG_1042.jpg')).toBeTruthy()
    expect(within(dialog).getByText('Fujifilm X100VI')).toBeTruthy()
    expect(within(dialog).getByText('6240')).toBeTruthy()
    expect(within(dialog).getByText('4160')).toBeTruthy()
    expect(within(dialog).getByText('2400000')).toBeTruthy()
    expect(within(dialog).getByText('image/jpeg')).toBeTruthy()
    expect(within(dialog).getByText('001')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Insert {taken:YYYY-MM-DD}' })).toHaveProperty('disabled', false)
    expect(within(dialog).getAllByRole('button', { name: /^Insert / })).toHaveLength(15)
    for (const value of ['6240x4160', '3x2', '25.96', 'landscape']) expect(within(dialog).getByText(value)).toBeTruthy()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'View metadata for IMG_1042.jpg' }))
    expect(screen.getByRole('checkbox', { name: 'Select IMG_1042.jpg' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: 'Rename 8 files' })).toHaveProperty('disabled', false)

    await user.click(screen.getByRole('checkbox', { name: 'Select IMG_1042.jpg' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Select IMG_1042.jpg' }).getAttribute('aria-checked')).toBe('false')
  })

  it('opens metadata with the keyboard and inserts a usable token into the pattern', async () => {
    const user = userEvent.setup()
    render(<App />)

    await replaceInput(user, replacementInput(), '{name}-')
    const opener = screen.getByRole('button', { name: 'View metadata for IMG_1042.jpg' })
    opener.focus()
    await user.keyboard('{Enter}')
    await user.click(within(screen.getByRole('dialog', { name: 'File metadata' })).getByRole('button', { name: 'Insert {camera}' }))

    await waitFor(() => expect(document.activeElement).toBe(replacementInput()))
    expect(replacementInput().value).toBe('{name}-{camera}')
    expect(replacementInput().selectionStart).toBe('{name}-{camera}'.length)
    expect(targetFilename('IMG_1042.jpg').textContent).toBe('IMG_1042-Fujifilm X100VI')
    expect(screen.queryByRole('dialog')).toBeNull()

    opener.focus()
    await user.keyboard(' ')
    expect(screen.getByRole('dialog', { name: 'File metadata' })).toBeTruthy()
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'File metadata' })).toBeTruthy()
  })

  it('shows unavailable metadata for unmatched files without inventing values', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'View metadata for shoot-notes.md' }))
    const dialog = within(screen.getByRole('dialog', { name: 'File metadata' }))
    expect(dialog.getByText('shoot-notes')).toBeTruthy()
    expect(dialog.getByText('text/markdown')).toBeTruthy()
    expect(dialog.getAllByText('Not available')).toHaveLength(9)
    for (const token of ['{taken:YYYY-MM-DD}', '{camera}', '{width}', '{height}', '{index:3}', '{dimensions}', '{aspect}', '{megapixels}', '{orientation}']) {
      expect(dialog.getByRole('button', { name: `Insert ${token}` })).toHaveProperty('disabled', true)
    }
    expect(dialog.getByRole('button', { name: 'Insert {modified:YYYY-MM-DD}' })).toHaveProperty('disabled', false)
    expect(dialog.getByText('Select this file and match its name to assign a sequence number.')).toBeTruthy()
  })

  it('shows sequence numbers from selected matches independently of search filters', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('checkbox', { name: 'Select IMG_1042.jpg' }))
    await user.click(screen.getByRole('button', { name: /^Matched/ }))
    await user.type(screen.getByRole('textbox', { name: 'Search files' }), 'IMG_1045.jpg')
    await user.click(screen.getByRole('button', { name: 'View metadata for IMG_1045.jpg' }))
    expect(within(screen.getByRole('dialog')).getByText('003')).toBeTruthy()
    await user.keyboard('{Escape}')

    await replaceInput(user, screen.getByRole('textbox', { name: 'Find a pattern' }), '[')
    await user.click(screen.getByRole('button', { name: /^All files/ }))
    await user.click(screen.getByRole('button', { name: 'View metadata for IMG_1045.jpg' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('button', { name: 'Insert {index:3}' })).toHaveProperty('disabled', true)
    expect(dialog.getByText('Fujifilm X100VI')).toBeTruthy()
  })

  it('inspects local files with relative paths, empty extensions, and missing MIME types', async () => {
    const user = userEvent.setup()
    vi.spyOn(filesystem, 'pickDirectory').mockResolvedValue({ name: 'Local folder' } as FileSystemDirectoryHandle)
    vi.spyOn(filesystem, 'scanDirectory').mockResolvedValue([{
      id: 'local-readme', name: 'README', path: 'docs/README', size: 0, type: '', lastModified: Date.UTC(2026, 9, 12, 14, 5, 9), metadata: {},
    }])
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await user.click(await screen.findByRole('button', { name: 'View metadata for docs/README' }))
    const dialog = within(screen.getByRole('dialog', { name: 'File metadata' }))
    expect(dialog.getByText('docs/README')).toBeTruthy()
    expect(dialog.getByText('No extension')).toBeTruthy()
    expect(dialog.getByText('0')).toBeTruthy()
    expect(dialog.getByText('2026-10-12 14:05:09 UTC')).toBeTruthy()
    expect(dialog.getByText('2026-10-12')).toBeTruthy()
    expect(dialog.getByRole('button', { name: 'Insert {ext}' })).toHaveProperty('disabled', false)
    expect(dialog.getByRole('button', { name: 'Insert {type}' })).toHaveProperty('disabled', true)
  })

  it('opens with a usable demo and the current rename preview', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Studio selects' })).toBeTruthy()
    expect(screen.getAllByRole('row')).toHaveLength(13)
    expect(targetFilename('IMG_1042.jpg').textContent).toBe('studio-001.jpg')
    expect(targetFilename('IMG_1049.jpg').textContent).toBe('studio-008.jpg')
    expect(fileRow('shoot-notes.md').getByText('No match')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rename 8 files' })).toHaveProperty('disabled', false)
  })

  it('uses the same capture groups in the pattern, replacement, and matched filenames', async () => {
    const user = userEvent.setup()
    render(<App />)

    const source = sourceFilename('IMG_1042.jpg')
    expect(source.textContent).toBe('IMG_1042.jpg')
    expect(Array.from(source.querySelectorAll('.hl-match'), mark => mark.textContent)).toEqual(['IMG_', '.'])
    expect(source.querySelector('[data-capture-group="1"]')?.textContent).toBe('1042')
    expect(source.querySelector('[data-capture-group="2"]')?.textContent).toBe('jpg')
    expect(sourceFilename('shoot-notes.md').querySelector('mark')).toBeNull()

    const expression = patternHighlight(screen.getByRole('textbox', { name: 'Find a pattern' }))
    expect(expression.getAttribute('aria-hidden')).toBe('true')
    expect(expression.querySelector('[data-capture-group="1"]')).toBeTruthy()
    expect(expression.querySelector('[data-capture-group="2"]')).toBeTruthy()

    await replaceInput(user, replacementInput(), '$1-$2-$&-{ext}')
    const replacement = patternHighlight(replacementInput())
    expect(replacement.querySelector('[data-capture-group="1"]')?.textContent).toBe('$1')
    expect(replacement.querySelector('[data-capture-group="2"]')?.textContent).toBe('$2')
    expect(replacement.querySelector('.hl-match')?.textContent).toBe('$&')
    expect(replacement.querySelector('.hl-metadata')?.textContent).toBe('{ext}')
    expect(targetFilename('IMG_1042.jpg').textContent).toBe('1042-jpg-IMG_1042.jpg-jpg')

    await replaceInput(user, screen.getByRole('textbox', { name: 'Find a pattern' }), '^IMG_\\d+\\.(jpg|png)$')
    expect(source.querySelector('[data-capture-group="1"]')?.textContent).toBe('jpg')
    expect(source.querySelector('[data-capture-group="2"]')).toBeNull()
    expect(replacement.querySelector('[data-capture-group="2"]')).toBeNull()
  })

  it('uses matching token colors for formatted metadata in the new name pattern and preview', () => {
    render(<App />)

    const pattern = patternHighlight(replacementInput())
    const target = targetFilename('IMG_1042.jpg')
    expect(target.textContent).toBe('studio-001.jpg')
    for (const [token, expression, value] of [['index', '{index|pad(3)}', '001'], ['ext', '{ext|lower}', 'jpg']]) {
      const patternToken = pattern.querySelector(`[data-metadata-token="${token}"]`)
      const resultToken = target.querySelector(`[data-metadata-token="${token}"]`)
      expect(patternToken?.textContent).toBe(expression)
      expect(resultToken?.textContent).toBe(value)
      expect(patternToken?.classList.contains(`hl-token-${token}`)).toBe(true)
      expect(resultToken?.classList.contains(`hl-token-${token}`)).toBe(true)
      expect(resultToken?.classList.contains('hl-metadata')).toBe(true)
    }
    expect(Array.from(target.querySelectorAll('mark'), mark => mark.textContent)).toEqual(['001', 'jpg'])
    expect(targetFilename('IMG_1049.jpg').querySelector('[data-metadata-token="index"]')?.textContent).toBe('008')
    expect(targetFilename('shoot-notes.md').querySelector('mark')).toBeNull()
  })

  it('tracks repeated metadata tokens and leaves identical literal text unhighlighted during live edits', async () => {
    const user = userEvent.setup()
    render(<App />)

    await replaceInput(user, replacementInput(), 'jpg-{ext}.jpg-{ext}')
    const target = targetFilename('IMG_1042.jpg')
    expect(target.textContent).toBe('jpg-jpg.jpg-jpg')
    expect(Array.from(target.querySelectorAll('mark'), mark => mark.textContent)).toEqual(['jpg', 'jpg'])
    expect(target.querySelectorAll('.hl-token-ext[data-metadata-token="ext"]')).toHaveLength(2)
    expect(patternHighlight(replacementInput()).querySelectorAll('.hl-token-ext[data-metadata-token="ext"]')).toHaveLength(2)
    expect(Array.from(target.childNodes, node => node.nodeType === Node.TEXT_NODE ? node.textContent : '').join('')).toBe('jpg-.jpg-')

    await replaceInput(user, replacementInput(), '{name}.{ext}')
    expect(target.textContent).toBe('IMG_1042.jpg')
    expect(target.querySelector('.hl-token-name[data-metadata-token="name"]')?.textContent).toBe('IMG_1042')
    expect(target.querySelectorAll('.hl-token-ext[data-metadata-token="ext"]')).toHaveLength(1)
    expect(target.querySelector('[data-metadata-token="index"]')).toBeNull()

    await replaceInput(user, replacementInput(), 'literal.jpg')
    expect(target.textContent).toBe('literal.jpg')
    expect(target.querySelector('mark')).toBeNull()
  })

  it('keeps capture and metadata highlights aligned when selection and view filters change', async () => {
    const user = userEvent.setup()
    render(<App />)

    await replaceInput(user, replacementInput(), '$1-{index:2}.{ext}')
    expect(targetFilename('IMG_1042.jpg').textContent).toBe('1042-01.jpg')
    expect(targetFilename('IMG_1042.jpg').querySelector('[data-capture-group="1"]')?.textContent).toBe('1042')
    await user.click(screen.getByRole('checkbox', { name: 'Select IMG_1042.jpg' }))
    expect(targetFilename('IMG_1042.jpg').textContent).toBe('Excluded')
    expect(targetFilename('IMG_1042.jpg').querySelector('mark')).toBeNull()
    expect(targetFilename('IMG_1043.jpg').querySelector('[data-metadata-token="index"]')?.textContent).toBe('01')

    await user.click(screen.getByRole('button', { name: /^Matched/ }))
    await user.type(screen.getByRole('textbox', { name: 'Search files' }), 'IMG_1045.jpg')
    const target = targetFilename('IMG_1045.jpg')
    expect(target.textContent).toBe('1045-03.jpg')
    expect(target.querySelector('[data-capture-group="1"]')?.textContent).toBe('1045')
    expect(target.querySelector('.hl-token-index[data-metadata-token="index"]')?.textContent).toBe('03')
    expect(target.querySelector('.hl-token-ext[data-metadata-token="ext"]')?.textContent).toBe('jpg')
  })

  it('updates filename highlights immediately and clears them for exclusions or invalid expressions', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    const pattern = screen.getByRole('textbox', { name: 'Find a pattern' })

    await replaceInput(user, pattern, '^IMG_(1042)\\.jpg$')
    expect(sourceFilename('IMG_1042.jpg').querySelector('[data-capture-group="1"]')?.textContent).toBe('1042')
    expect(sourceFilename('IMG_1043.jpg').querySelector('mark')).toBeNull()

    await user.click(screen.getByRole('checkbox', { name: 'Select IMG_1042.jpg' }))
    expect(sourceFilename('IMG_1042.jpg').querySelector('mark')).toBeNull()
    await user.click(screen.getByRole('checkbox', { name: 'Select IMG_1042.jpg' }))
    expect(sourceFilename('IMG_1042.jpg').querySelector('mark')).toBeTruthy()

    await replaceInput(user, pattern, '[')
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(container.querySelectorAll('.filename-cell mark')).toHaveLength(0)
    expect(sourceFilename('IMG_1042.jpg').textContent).toBe('IMG_1042.jpg')

    await replaceInput(user, pattern, '^IMG_(1043)\\.jpg$')
    expect(sourceFilename('IMG_1042.jpg').querySelector('mark')).toBeNull()
    expect(sourceFilename('IMG_1043.jpg').querySelector('[data-capture-group="1"]')?.textContent).toBe('1043')
  })

  it('highlights only the first match unless the global option is enabled', async () => {
    const user = userEvent.setup()
    render(<App />)

    await replaceInput(user, screen.getByRole('textbox', { name: 'Find a pattern' }), '\\d')
    const source = sourceFilename('IMG_1042.jpg')
    const matchedText = () => Array.from(source.querySelectorAll('.hl-match'), mark => mark.textContent).join('')
    expect(matchedText()).toBe('1')

    await user.click(screen.getByRole('checkbox', { name: /^Global/ }))
    expect(matchedText()).toBe('1042')
    expect(source.textContent).toBe('IMG_1042.jpg')

    await user.click(screen.getByRole('checkbox', { name: /^Global/ }))
    expect(matchedText()).toBe('1')
  })

  it('updates capture replacements immediately and blocks collisions or invalid expressions', async () => {
    const user = userEvent.setup()
    render(<App />)

    await replaceInput(user, replacementInput(), 'archive-$1.{ext}')
    expect(targetFilename('IMG_1042.jpg').textContent).toBe('archive-1042.jpg')
    expect(targetFilename('IMG_1049.jpg').textContent).toBe('archive-1049.jpg')

    await replaceInput(user, replacementInput(), 'same.jpg')
    expect(screen.getAllByText('Multiple files would have the same destination.')).toHaveLength(8)
    expect(screen.getByText('8 conflicts')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rename 0 files' })).toHaveProperty('disabled', true)

    await replaceInput(user, screen.getByRole('textbox', { name: 'Find a pattern' }), '[')
    expect(screen.getByRole('alert').textContent).toMatch(/regular expression|character class/i)
    expect(screen.getByRole('button', { name: 'Rename 0 files' })).toHaveProperty('disabled', true)

    await replaceInput(user, screen.getByRole('textbox', { name: 'Find a pattern' }), '^IMG_(\\d+)\\.jpg$')
    await replaceInput(user, replacementInput(), 'fixed-$1.jpg')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Rename 8 files' })).toHaveProperty('disabled', false)
  })

  it('reindexes selected matches while keeping search and view filters separate from the rename selection', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('checkbox', { name: 'Select IMG_1042.jpg' }))
    expect(fileRow('IMG_1042.jpg').getByText('Excluded')).toBeTruthy()
    expect(targetFilename('IMG_1043.jpg').textContent).toBe('studio-001.jpg')

    await user.click(screen.getByRole('button', { name: /^Matched/ }))
    expect(screen.getAllByRole('row')).toHaveLength(8)
    expect(screen.queryByRole('checkbox', { name: 'Select IMG_1042.jpg' })).toBeNull()

    await user.type(screen.getByRole('textbox', { name: 'Search files' }), 'IMG_1045.jpg')
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(targetFilename('IMG_1045.jpg').textContent).toBe('studio-003.jpg')
    expect(screen.getByRole('button', { name: 'Rename 7 files' })).toHaveProperty('disabled', false)

    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getAllByRole('row')).toHaveLength(8)
  })

  it('preserves exclusions during refresh and recursive rescan while selecting newly discovered files', async () => {
    const user = userEvent.setup()
    const root = { name: 'Test folder' } as FileSystemDirectoryHandle
    const files = createDemoFiles()
    const nestedFile = { ...files[0], id: 'nested/IMG_1050.jpg', path: 'nested/IMG_1050.jpg', name: 'IMG_1050.jpg' }
    vi.spyOn(filesystem, 'pickDirectory').mockResolvedValue(root)
    const scan = vi.spyOn(filesystem, 'scanDirectory')
      .mockResolvedValueOnce(files)
      .mockResolvedValueOnce(files.map(file => ({ ...file })))
      .mockResolvedValueOnce([...files, nestedFile])
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    expect(await screen.findByRole('heading', { name: 'Test folder' })).toBeTruthy()
    await user.click(screen.getByRole('checkbox', { name: 'Select IMG_1042.jpg' }))
    expect(fileRow('IMG_1042.jpg').getByText('Excluded')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Refresh folder' }))
    expect(scan).toHaveBeenNthCalledWith(2, root, false)
    expect(screen.getByRole('checkbox', { name: 'Select IMG_1042.jpg' }).getAttribute('aria-checked')).toBe('false')
    expect(fileRow('IMG_1042.jpg').getByText('Excluded')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rename 7 files' })).toHaveProperty('disabled', false)

    await user.click(screen.getByRole('switch', { name: 'Include subfolders' }))
    expect(scan).toHaveBeenNthCalledWith(3, root, true)
    expect(screen.getByRole('checkbox', { name: 'Select IMG_1042.jpg' }).getAttribute('aria-checked')).toBe('false')
    expect(fileRow('IMG_1042.jpg').getByText('Excluded')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Select IMG_1050.jpg' }).getAttribute('aria-checked')).toBe('true')
    expect(targetFilename('IMG_1050.jpg').textContent).toBe('nested/studio-008.jpg')
    const nestedSource = sourceFilename('IMG_1050.jpg', 'nested/IMG_1050.jpg')
    expect(nestedSource.textContent).toBe('nested/IMG_1050.jpg')
    expect(nestedSource.querySelector('[data-capture-group="1"]')?.textContent).toBe('1050')
    expect(Array.from(nestedSource.querySelectorAll('mark')).every(mark => !mark.textContent?.includes('nested/'))).toBe(true)
    expect(screen.getByRole('button', { name: 'Rename 8 files' })).toHaveProperty('disabled', false)
  })

  it('confirms a demo rename, records its results, and restores the files with undo', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Rename 8 files' }))
    const dialog = screen.getByRole('dialog', { name: 'A new name for 8 files.' })
    expect(within(dialog).getByText(/practice run with sample files/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Try the rename' }))

    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('8 demo files renamed.'))
    expect(fileRow('studio-001.jpg').getByText('No match')).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'Select IMG_1042.jpg' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Rename activity' }))
    const history = screen.getByRole('dialog', { name: 'Your activity.' })
    expect(within(history).getByText('IMG_1042.jpg')).toBeTruthy()
    expect(within(history).getByText('studio-001.jpg')).toBeTruthy()
    await user.click(within(history).getByRole('button', { name: 'Close dialog' }))

    await user.click(screen.getByRole('checkbox', { name: 'Select studio-001.jpg' }))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('status').textContent).toContain('Demo rename undone.')
    expect(fileRow('IMG_1042.jpg').getByText('Excluded')).toBeTruthy()
    expect(targetFilename('IMG_1043.jpg').textContent).toBe('studio-001.jpg')
    expect(screen.getByRole('button', { name: 'Rename 7 files' })).toHaveProperty('disabled', false)
  })

  it('finds and applies templates, then saves a rule that is available after remounting', async () => {
    const user = userEvent.setup()
    const app = render(<App />)

    const templateOpener = screen.getByRole('button', { name: 'Templates' })
    await user.click(templateOpener)
    let dialog = screen.getByRole('dialog', { name: 'A rule for almost everything.' })
    const templateSearch = within(dialog).getByRole('textbox', { name: 'Search templates' })
    await waitFor(() => expect(document.activeElement).toBe(templateSearch))
    await user.type(templateSearch, 'Folders by extension')
    await user.click(within(dialog).getByRole('button', { name: /Folders by extension/ }))
    await waitFor(() => expect(document.activeElement).toBe(templateOpener))
    expect(replacementInput().value).toBe('{ext|lower|default("no-extension")}/$&')
    expect(targetFilename('IMG_1042.jpg').textContent).toBe('jpg/IMG_1042.jpg')
    expect(targetFilename('shoot-notes.md').textContent).toBe('md/shoot-notes.md')

    await user.click(screen.getByRole('button', { name: 'Save as a template' }))
    dialog = screen.getByRole('dialog', { name: 'Save your naming rule.' })
    await replaceInput(user, within(dialog).getByRole('textbox', { name: 'Template name' }), 'My folder rule')
    await user.click(within(dialog).getByRole('button', { name: 'Save template' }))
    expect(JSON.parse(localStorage.getItem('renameotron.templates') ?? '[]')).toEqual([
      expect.objectContaining({ name: 'My folder rule', replacement: '{ext|lower|default("no-extension")}/$&', category: 'Saved' }),
    ])

    app.unmount()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Templates' }))
    dialog = screen.getByRole('dialog', { name: 'A rule for almost everything.' })
    await user.click(within(dialog).getByRole('button', { name: 'Saved' }))
    await user.click(within(dialog).getByRole('button', { name: /My folder rule/ }))
    expect(replacementInput().value).toBe('{ext|lower|default("no-extension")}/$&')
    expect(screen.getByRole('button', { name: 'Rename 12 files' })).toHaveProperty('disabled', false)
  })

  it('completes a metadata token from the keyboard and uses its formatting in the preview', async () => {
    const user = userEvent.setup()
    render(<App />)

    await replaceInput(user, replacementInput(), '{ind')
    expect(screen.getByRole('listbox', { name: 'File metadata' })).toBeTruthy()
    expect(screen.getByRole('option', { name: /\{index:3\}/ })).toBeTruthy()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(replacementInput().value).toBe('{index:3}'))
    expect(screen.queryByRole('listbox')).toBeNull()

    await user.paste('.{ext}')
    expect(targetFilename('IMG_1042.jpg').textContent).toBe('001.jpg')
    expect(targetFilename('IMG_1049.jpg').textContent).toBe('008.jpg')
  })

  it('explains unavailable folder access and keeps the demo usable', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/supported desktop Chromium browser/)
    expect(screen.getByRole('heading', { name: 'Studio selects' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rename 8 files' })).toHaveProperty('disabled', false)
  })

  it('builds a chain from file metadata and inserts the previewed result', async () => {
    const user = userEvent.setup()
    render(<App />)
    await replaceInput(user, replacementInput(), '{name}-')
    await user.click(screen.getByRole('button', { name: 'View metadata for IMG_1042.jpg' }))
    let dialog = within(screen.getByRole('dialog', { name: 'File metadata' }))
    await user.click(dialog.getByRole('button', { name: 'Customize Camera' }))
    dialog = within(screen.getByRole('dialog', { name: 'File metadata' }))
    for (const modifier of ['trim', 'lower', 'whitespace']) {
      await user.selectOptions(dialog.getByRole('combobox', { name: 'Add a modifier' }), modifier)
      await user.click(dialog.getByRole('button', { name: 'Add' }))
    }
    expect(document.activeElement).toBe(dialog.getByRole('textbox', { name: 'Modifier 3' }))
    expect(dialog.getByRole('status').textContent).toBe('fujifilm-x100vi')
    await user.click(dialog.getByRole('button', { name: 'Insert pattern' }))
    expect(replacementInput().value).toBe('{name}-{camera|trim|lower|whitespace("-")}')
    expect(targetFilename('IMG_1042.jpg').textContent).toBe('IMG_1042-fujifilm-x100vi')
    expect(targetFilename('IMG_1042.jpg').querySelector('[data-metadata-token="camera"]')?.textContent).toBe('fujifilm-x100vi')
    await waitFor(() => expect(document.activeElement).toBe(replacementInput()))
  })

  it('previews reordered and edited modifiers and prevents inserting invalid expressions', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Modifiers' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Metadata & modifiers' }))
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Metadata' }), 'camera')
    for (const modifier of ['prefix', 'upper']) {
      await user.selectOptions(dialog.getByRole('combobox', { name: 'Add a modifier' }), modifier)
      await user.click(dialog.getByRole('button', { name: 'Add' }))
    }
    expect(dialog.getByRole('status').textContent).toBe('PHOTO-FUJIFILM X100VI')
    await user.click(dialog.getByRole('button', { name: 'Move modifier 2 up' }))
    expect(dialog.getByRole('status').textContent).toBe('photo-FUJIFILM X100VI')
    await user.click(dialog.getByRole('button', { name: 'Remove modifier 1' }))
    expect(dialog.getByRole('status').textContent).toBe('photo-Fujifilm X100VI')
    await replaceInput(user, dialog.getByRole('textbox', { name: 'Modifier 1' }), 'prefix("camera-")')
    expect(dialog.getByRole('status').textContent).toBe('camera-Fujifilm X100VI')
    await replaceInput(user, dialog.getByRole('textbox', { name: 'Modifier 1' }), 'prefix(')
    expect(dialog.getByRole('button', { name: 'Insert pattern' })).toHaveProperty('disabled', true)
    expect(dialog.getByText(/Close the parentheses/)).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Modifiers' })))
  })

  it('formats bytes through the builder and allows a fallback for unavailable metadata', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Modifiers' }))
    let dialog = within(screen.getByRole('dialog', { name: 'Metadata & modifiers' }))
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Metadata' }), 'size')
    for (const modifier of ['bytes', 'whitespace']) {
      await user.selectOptions(dialog.getByRole('combobox', { name: 'Add a modifier' }), modifier)
      await user.click(dialog.getByRole('button', { name: 'Add' }))
    }
    expect(dialog.getByRole('status').textContent).toBe('2.4-MB')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'View metadata for shoot-notes.md' }))
    dialog = within(screen.getByRole('dialog', { name: 'File metadata' }))
    await user.click(dialog.getByRole('button', { name: 'Customize Camera' }))
    expect(document.activeElement).toBe(dialog.getByRole('combobox', { name: 'Metadata' }))
    expect(dialog.getByRole('button', { name: 'Insert pattern' })).toHaveProperty('disabled', true)
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Add a modifier' }), 'default')
    await user.click(dialog.getByRole('button', { name: 'Add' }))
    expect(dialog.getByRole('status').textContent).toBe('unknown')
    expect(dialog.getByRole('button', { name: 'Insert pattern' })).toHaveProperty('disabled', false)
    await user.click(dialog.getByRole('button', { name: 'All metadata' }))
    expect(document.activeElement).toBe(dialog.getByRole('button', { name: 'Customize Camera' }))
  })

  it('validates modifier arguments and date formats without a sample file', async () => {
    const user = userEvent.setup()
    const insert = vi.fn()
    render(<MetadataPatternBuilder onInsert={insert} />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Add a modifier' }), 'round')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await replaceInput(user, screen.getByRole('textbox', { name: 'Modifier 1' }), 'round(99)')
    expect(screen.getByText(/whole number from 0 to 12/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Insert pattern' })).toHaveProperty('disabled', true)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Metadata' }), 'modified')
    await user.type(screen.getByRole('textbox', { name: 'Date format (UTC)' }), 'invalid')
    expect(screen.getByRole('button', { name: 'Insert pattern' })).toHaveProperty('disabled', true)
    await replaceInput(user, screen.getByRole('textbox', { name: 'Date format (UTC)' }), 'YYYY-MM')
    await user.click(screen.getByRole('button', { name: 'Insert pattern' }))
    expect(insert).toHaveBeenCalledWith('{modified:YYYY-MM}')
  })
})

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
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

async function replaceInput(user: ReturnType<typeof userEvent.setup>, input: HTMLElement, value: string) {
  await user.clear(input)
  await user.paste(value)
}

describe('renameotron workspace', () => {
  it('opens with a usable demo and the current rename preview', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Studio selects' })).toBeTruthy()
    expect(screen.getAllByRole('row')).toHaveLength(13)
    expect(fileRow('IMG_1042.jpg').getByText('studio-001.jpg')).toBeTruthy()
    expect(fileRow('IMG_1049.jpg').getByText('studio-008.jpg')).toBeTruthy()
    expect(fileRow('shoot-notes.md').getByText('No match')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rename 8 files' })).toHaveProperty('disabled', false)
  })

  it('updates capture replacements immediately and blocks collisions or invalid expressions', async () => {
    const user = userEvent.setup()
    render(<App />)

    await replaceInput(user, replacementInput(), 'archive-$1.{ext}')
    expect(fileRow('IMG_1042.jpg').getByText('archive-1042.jpg')).toBeTruthy()
    expect(fileRow('IMG_1049.jpg').getByText('archive-1049.jpg')).toBeTruthy()

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
    expect(fileRow('IMG_1043.jpg').getByText('studio-001.jpg')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /^Matched/ }))
    expect(screen.getAllByRole('row')).toHaveLength(8)
    expect(screen.queryByRole('checkbox', { name: 'Select IMG_1042.jpg' })).toBeNull()

    await user.type(screen.getByRole('textbox', { name: 'Search files' }), '1045')
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(fileRow('IMG_1045.jpg').getByText('studio-003.jpg')).toBeTruthy()
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
    expect(fileRow('IMG_1050.jpg').getByText('nested/studio-008.jpg')).toBeTruthy()
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
    expect(fileRow('IMG_1043.jpg').getByText('studio-001.jpg')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rename 7 files' })).toHaveProperty('disabled', false)
  })

  it('finds and applies templates, then saves a rule that is available after remounting', async () => {
    const user = userEvent.setup()
    const app = render(<App />)

    await user.click(screen.getByRole('button', { name: 'Templates' }))
    let dialog = screen.getByRole('dialog', { name: 'A rule for almost everything.' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Search templates' }), 'Folders by extension')
    await user.click(within(dialog).getByRole('button', { name: /Folders by extension/ }))
    expect(replacementInput().value).toBe('{ext}/{name}.{ext}')
    expect(fileRow('IMG_1042.jpg').getByText('jpg/IMG_1042.jpg')).toBeTruthy()
    expect(fileRow('shoot-notes.md').getByText('md/shoot-notes.md')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Save as a template' }))
    dialog = screen.getByRole('dialog', { name: 'Save your naming rule.' })
    await replaceInput(user, within(dialog).getByRole('textbox', { name: 'Template name' }), 'My folder rule')
    await user.click(within(dialog).getByRole('button', { name: 'Save template' }))
    expect(JSON.parse(localStorage.getItem('renameotron.templates') ?? '[]')).toEqual([
      expect.objectContaining({ name: 'My folder rule', replacement: '{ext}/{name}.{ext}', category: 'Saved' }),
    ])

    app.unmount()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Templates' }))
    dialog = screen.getByRole('dialog', { name: 'A rule for almost everything.' })
    await user.click(within(dialog).getByRole('button', { name: 'Saved' }))
    await user.click(within(dialog).getByRole('button', { name: /My folder rule/ }))
    expect(replacementInput().value).toBe('{ext}/{name}.{ext}')
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
    expect(fileRow('IMG_1042.jpg').getByText('001.jpg')).toBeTruthy()
    expect(fileRow('IMG_1049.jpg').getByText('008.jpg')).toBeTruthy()
  })

  it('explains unavailable folder access and keeps the demo usable', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/supported desktop Chromium browser/)
    expect(screen.getByRole('heading', { name: 'Studio selects' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rename 8 files' })).toHaveProperty('disabled', false)
  })
})

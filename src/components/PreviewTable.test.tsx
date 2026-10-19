// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'

const STORAGE_KEY = 'renameotron.preview-columns'

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

function columnOrder() {
  return screen.getAllByRole('button', { name: /^Sort by / })
    .map(button => button.getAttribute('aria-label')?.replace('Sort by ', ''))
}

function fileOrder() {
  return within(screen.getByRole('region', { name: 'File rename preview' }))
    .queryAllByRole('checkbox', { name: /^Select (?!all )/ })
    .map(checkbox => checkbox.getAttribute('aria-label')?.replace('Select ', ''))
}

function targetFilename(name: string) {
  const row = screen.getByRole('checkbox', { name: `Select ${name}` }).closest('tr')
  const target = row?.querySelector('.target-name')
  if (!target) throw new Error(`No target filename found for ${name}`)
  return target.textContent
}

async function manageColumns(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Columns' }))
  return within(screen.getByRole('dialog', { name: 'Manage columns' }))
}

describe('preview table controls', () => {
  it('adds, removes and reorders columns, restores them on remount, and resets the layout', async () => {
    const user = userEvent.setup()
    const app = render(<App />)
    expect(columnOrder()).toEqual(['From', 'To', 'Size'])

    const manager = await manageColumns(user)
    await user.click(manager.getByRole('checkbox', { name: 'Show Camera column' }))
    await user.click(manager.getByRole('button', { name: 'Move Camera left' }))
    await user.click(manager.getByRole('button', { name: 'Remove Size column' }))
    await user.keyboard('{Escape}')
    expect(columnOrder()).toEqual(['From', 'To', 'Camera'])

    await user.click(screen.getByRole('button', { name: 'Sort by Camera' }))
    app.unmount()
    render(<App />)
    expect(columnOrder()).toEqual(['From', 'To', 'Camera'])
    expect(screen.getByRole('button', { name: 'Sort by Camera' }).closest('th')?.getAttribute('aria-sort')).toBe('ascending')

    const restoredManager = await manageColumns(user)
    expect(restoredManager.getByRole('checkbox', { name: 'Show Camera column' }).getAttribute('aria-checked')).toBe('true')
    expect(restoredManager.getByRole('checkbox', { name: 'Show Size column' }).getAttribute('aria-checked')).toBe('false')
    await user.click(restoredManager.getByRole('button', { name: 'Reset columns' }))
    await user.keyboard('{Escape}')
    expect(columnOrder()).toEqual(['From', 'To', 'Size'])
    expect(fileOrder()[0]).toBe('IMG_1042.jpg')
  })

  it('searches hidden metadata and combines independent column filters with global search', async () => {
    const user = userEvent.setup()
    render(<App />)
    const search = screen.getByRole('textbox', { name: 'Search files' })

    await user.type(search, 'fujifilm')
    expect(fileOrder()).toHaveLength(8)
    expect(fileOrder()).not.toContain('shoot-notes.md')

    const manager = await manageColumns(user)
    await user.click(manager.getByRole('checkbox', { name: 'Show Camera column' }))
    await user.click(manager.getByRole('checkbox', { name: 'Show Width column' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Column filters' }))
    await user.type(screen.getByRole('textbox', { name: 'Filter Camera' }), 'X100VI')
    await user.type(screen.getByRole('textbox', { name: 'Filter Width' }), '6240')
    await user.clear(search)
    await user.type(search, 'IMG_1045.jpg')
    expect(fileOrder()).toEqual(['IMG_1045.jpg'])
    expect(targetFilename('IMG_1045.jpg')).toBe('studio-004.jpg')

    await user.clear(screen.getByRole('textbox', { name: 'Filter Camera' }))
    await user.type(screen.getByRole('textbox', { name: 'Filter Camera' }), 'Canon')
    expect(fileOrder()).toEqual([])
    await user.clear(screen.getByRole('textbox', { name: 'Filter Camera' }))
    await user.type(screen.getByRole('textbox', { name: 'Filter Camera' }), 'X100VI')
    expect(fileOrder()).toEqual(['IMG_1045.jpg'])

    await user.clear(screen.getByRole('textbox', { name: 'Filter Width' }))
    await user.type(screen.getByRole('textbox', { name: 'Filter Width' }), '4160')
    expect(fileOrder()).toEqual([])
    expect(screen.getByText('No files in this view.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(search).toHaveProperty('value', '')
    expect(screen.getByRole('textbox', { name: 'Filter Camera' })).toHaveProperty('value', '')
    expect(screen.getByRole('textbox', { name: 'Filter Width' })).toHaveProperty('value', '')
    expect(fileOrder()).toHaveLength(12)
  })

  it('keeps collapsed column filters active and clears a filter when its column is removed', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Column filters' }))
    await user.type(screen.getByRole('textbox', { name: 'Filter To' }), 'studio-001')
    expect(fileOrder()).toEqual(['IMG_1042.jpg'])
    await user.click(screen.getByRole('button', { name: 'Column filters' }))
    expect(screen.queryByRole('textbox', { name: 'Filter To' })).toBeNull()
    expect(fileOrder()).toEqual(['IMG_1042.jpg'])
    expect(screen.getByRole('button', { name: 'Clear To filter' })).toBeTruthy()

    const manager = await manageColumns(user)
    await user.click(manager.getByRole('button', { name: 'Remove To column' }))
    await user.keyboard('{Escape}')
    expect(fileOrder()).toHaveLength(12)
    expect(screen.queryByRole('button', { name: 'Clear To filter' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })

  it('clears filters when reloading files while preserving sorting, widths, and visible filter inputs', async () => {
    const user = userEvent.setup()
    render(<App />)
    const resize = screen.getByRole('separator', { name: 'Resize From column' })
    resize.focus()
    await user.keyboard('{ArrowRight}')
    const width = resize.getAttribute('aria-valuenow')
    await user.click(screen.getByRole('button', { name: 'Sort by Size' }))
    await user.click(screen.getByRole('button', { name: 'Rename 8 files' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Try the rename' }))
    await screen.findByRole('button', { name: 'Undo' })
    await user.click(screen.getByRole('button', { name: 'Column filters' }))
    await user.type(screen.getByRole('textbox', { name: 'Filter From' }), 'studio-001')
    expect(fileOrder()).toEqual(['studio-001.jpg'])
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('textbox', { name: 'Filter From' })).toHaveProperty('value', '')
    expect(fileOrder()).toHaveLength(12)
    expect(screen.getByRole('button', { name: 'Sort by Size' }).closest('th')?.getAttribute('aria-sort')).toBe('ascending')
    expect(screen.getByRole('separator', { name: 'Resize From column' }).getAttribute('aria-valuenow')).toBe(width)
  })

  it('sorts file sizes numerically in both directions without changing rename targets or sequence', async () => {
    const user = userEvent.setup()
    render(<App />)
    const manager = await manageColumns(user)
    await user.click(manager.getByRole('checkbox', { name: 'Show Sequence column' }))
    await user.keyboard('{Escape}')
    const originalOrder = fileOrder()
    const sortSize = screen.getByRole('button', { name: 'Sort by Size' })

    await user.click(sortSize)
    expect(sortSize.closest('th')?.getAttribute('aria-sort')).toBe('ascending')
    expect(fileOrder().slice(0, 4)).toEqual(['readme.txt', 'shoot-notes.md', 'contact-sheet.pdf', 'moodboard.png'])
    expect(targetFilename('IMG_1042.jpg')).toBe('studio-001.jpg')
    expect(targetFilename('IMG_1049.jpg')).toBe('studio-008.jpg')

    await user.click(sortSize)
    expect(sortSize.closest('th')?.getAttribute('aria-sort')).toBe('descending')
    expect(fileOrder()[0]).toBe('IMG_1049.jpg')
    expect(fileOrder().at(-1)).toBe('readme.txt')
    expect(targetFilename('IMG_1042.jpg')).toBe('studio-001.jpg')
    expect(targetFilename('IMG_1049.jpg')).toBe('studio-008.jpg')
    const lastMatchedRow = screen.getByRole('checkbox', { name: 'Select IMG_1049.jpg' }).closest('tr')!
    expect(within(lastMatchedRow).getByRole('cell', { name: '8' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rename 8 files' })).toHaveProperty('disabled', false)

    await user.click(sortSize)
    expect(sortSize.closest('th')?.getAttribute('aria-sort')).toBe('none')
    expect(fileOrder()).toEqual(originalOrder)
  })

  it('changes only visible selections when selecting or deselecting a filtered view', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('checkbox', { name: 'Select IMG_1043.jpg' }))
    const search = screen.getByRole('textbox', { name: 'Search files' })
    await user.type(search, 'IMG_1042.jpg')
    const selectVisible = screen.getByRole('checkbox', { name: 'Select all visible files' })
    expect(selectVisible.getAttribute('aria-checked')).toBe('true')

    await user.click(selectVisible)
    expect(screen.getByRole('checkbox', { name: 'Select IMG_1042.jpg' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('button', { name: 'Rename 6 files' })).toHaveProperty('disabled', false)
    await user.click(selectVisible)
    expect(screen.getByRole('button', { name: 'Rename 7 files' })).toHaveProperty('disabled', false)

    await user.clear(search)
    expect(screen.getByRole('checkbox', { name: 'Select IMG_1042.jpg' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('checkbox', { name: 'Select IMG_1043.jpg' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('checkbox', { name: 'Select IMG_1044.jpg' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('checkbox', { name: 'Select all files' }).getAttribute('aria-checked')).toBe('mixed')
  })

  it('resizes columns by keyboard, enforces bounds, restores the default, and persists widths', async () => {
    const user = userEvent.setup()
    const app = render(<App />)
    const resize = screen.getByRole('separator', { name: 'Resize From column' })
    const defaultWidth = Number(resize.getAttribute('aria-valuenow'))
    expect(defaultWidth).toBeGreaterThan(96)
    resize.focus()

    await user.keyboard('{ArrowRight}')
    expect(resize.getAttribute('aria-valuenow')).toBe(String(defaultWidth + 16))
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}')
    expect(resize.getAttribute('aria-valuenow')).toBe(String(defaultWidth + 16 - 64))
    await user.keyboard('{Home}{ArrowLeft}')
    expect(resize.getAttribute('aria-valuenow')).toBe('96')
    await user.keyboard('{End}{ArrowRight}')
    expect(resize.getAttribute('aria-valuenow')).toBe('800')

    fireEvent.doubleClick(resize)
    expect(resize.getAttribute('aria-valuenow')).toBe(String(defaultWidth))
    resize.focus()
    await user.keyboard('{ArrowRight}')
    app.unmount()
    render(<App />)
    expect(screen.getByRole('separator', { name: 'Resize From column' }).getAttribute('aria-valuenow')).toBe(String(defaultWidth + 16))
  })

  it('keeps at least one column visible', async () => {
    const user = userEvent.setup()
    render(<App />)
    const manager = await manageColumns(user)
    await user.click(manager.getByRole('button', { name: 'Remove To column' }))
    await user.click(manager.getByRole('button', { name: 'Remove Size column' }))
    expect(manager.getByRole('button', { name: 'Remove From column' })).toHaveProperty('disabled', true)
    expect(manager.getByRole('checkbox', { name: 'Show From column' })).toHaveProperty('disabled', true)
    await user.keyboard('{Escape}')
    expect(columnOrder()).toEqual(['From'])
    expect(fileOrder()).toHaveLength(12)
  })

  it.each(['{invalid json', 'null', JSON.stringify({ ids: [], widths: { from: -100000 }, sort: { columnId: 'unknown', direction: 'sideways' } })])('recovers from invalid stored column preferences: %s', value => {
    localStorage.setItem(STORAGE_KEY, value)
    render(<App />)
    expect(columnOrder()).toEqual(['From', 'To', 'Size'])
    expect(fileOrder()).toHaveLength(12)
    expect(Number(screen.getByRole('separator', { name: 'Resize From column' }).getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(96)
  })
})

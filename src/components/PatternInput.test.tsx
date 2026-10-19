// @vitest-environment jsdom

import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PatternInput } from './PatternInput'

afterEach(cleanup)

function Editor({ initialValue = '' }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue)
  return <PatternInput id="replacement" kind="replacement" value={value} onChange={setValue} />
}

async function focusAt(user: ReturnType<typeof userEvent.setup>, cursor: number) {
  const input = screen.getByRole<HTMLInputElement>('combobox')
  await user.click(input)
  input.setSelectionRange(cursor, cursor)
  fireEvent.select(input)
  return input
}

describe('metadata autocomplete', () => {
  it('offers metadata after an opening brace and preserves the surrounding text', async () => {
    const user = userEvent.setup()
    render(<Editor initialValue="prefix-{-suffix" />)
    const input = await focusAt(user, 'prefix-{'.length)
    expect(screen.getByRole('listbox', { name: 'File metadata' })).toBeTruthy()
    await user.click(screen.getByRole('option', { name: /^\{name\}/ }))
    expect(input.value).toBe('prefix-{name}-suffix')
    await waitFor(() => expect(input.selectionStart).toBe('prefix-{name}'.length))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('reuses the existing closing brace when completing an empty token', async () => {
    const user = userEvent.setup()
    render(<Editor initialValue="prefix-{}-suffix" />)
    const input = await focusAt(user, 'prefix-{'.length)
    await user.click(screen.getByRole('option', { name: /^\{name\}/ }))
    expect(input.value).toBe('prefix-{name}-suffix')
  })

  it('offers modifiers when a pipe is typed before an existing closing brace', async () => {
    const user = userEvent.setup()
    render(<Editor initialValue="prefix-{name}-suffix" />)
    const input = await focusAt(user, 'prefix-{name'.length)
    await user.keyboard('|')
    expect(screen.getByRole('listbox', { name: 'Metadata modifiers' })).toBeTruthy()
    await user.keyboard('low{Enter}')
    expect(input.value).toBe('prefix-{name|lower}-suffix')
    await waitFor(() => expect(input.selectionStart).toBe('prefix-{name|lower}'.length))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('replaces the modifier being edited and preserves later modifiers and neighboring tokens', async () => {
    const user = userEvent.setup()
    const initialValue = 'prefix-{name|trim|lower|suffix("|{ext},$1")}-{index:3}'
    render(<Editor initialValue={initialValue} />)
    const input = await focusAt(user, 'prefix-{name|trim|lo'.length)
    await user.keyboard('{Enter}')
    expect(input.value).toBe(initialValue)
    await waitFor(() => expect(input.selectionStart).toBe('prefix-{name|trim|lower'.length))

    await focusAt(user, 'prefix-{name|trim|'.length)
    await user.keyboard('up{Enter}')
    expect(input.value).toBe('prefix-{name|trim|upper|suffix("|{ext},$1")}-{index:3}')
  })

  it('completes a token name in the middle without dropping its modifier chain', async () => {
    const user = userEvent.setup()
    render(<Editor initialValue="prefix-{name|trim|upper}.{ext}" />)
    const input = await focusAt(user, 'prefix-{na'.length)
    await user.click(screen.getByRole('option', { name: /^\{name\}/ }))
    expect(input.value).toBe('prefix-{name|trim|upper}.{ext}')
  })

  it('closes an unfinished chain when a modifier suggestion is accepted', async () => {
    const user = userEvent.setup()
    render(<Editor initialValue="{index:3|su" />)
    const input = await focusAt(user, '{index:3|su'.length)
    await user.keyboard('{Enter}')
    expect(input.value).toBe('{index:3|suffix("-edited")}')
  })

  it('does not offer suggestions inside quoted arguments, including literal braces and pipes', async () => {
    const user = userEvent.setup()
    const initialValue = String.raw`{name|replace("a\"|{ext}","{name}|$1")|lower}`
    render(<Editor initialValue={initialValue} />)
    for (const cursor of [initialValue.indexOf('{ext}') + 1, initialValue.indexOf('{ext}') + 4, initialValue.indexOf('{name}', 1) + 3, initialValue.indexOf('|$1') + 1]) {
      await focusAt(user, cursor)
      expect(screen.queryByRole('listbox')).toBeNull()
    }
    await focusAt(user, initialValue.indexOf('|lower') + 3)
    expect(screen.getByRole('listbox', { name: 'Metadata modifiers' })).toBeTruthy()
  })

  it('supports arrow navigation, Escape, and reopening after another edit', async () => {
    const user = userEvent.setup()
    render(<Editor initialValue="{name|}" />)
    const input = await focusAt(user, '{name|'.length)
    expect(screen.getByRole('option', { selected: true }).textContent).toMatch(/^lower/)
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { selected: true }).textContent).toMatch(/^upper/)
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('option', { selected: true }).textContent).toMatch(/^lower/)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input.value).toBe('{name|}')
    await user.keyboard('up{Enter}')
    expect(input.value).toBe('{name|upper}')
  })
})

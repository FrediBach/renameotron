// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConditionPatternBuilder } from './ConditionPatternBuilder'
import { createDemoFiles } from '@/lib/demo'

afterEach(cleanup)

async function replaceInput(user: ReturnType<typeof userEvent.setup>, input: HTMLElement, value: string) {
  await user.clear(input)
  await user.paste(value)
}

describe('condition pattern builder', () => {
  it('validates source conditions and branch syntax before files are available', async () => {
    const user = userEvent.setup()
    const insert = vi.fn()
    render(<ConditionPatternBuilder pattern="^.+$" replacement="" flags="" files={[]} selectedIds={new Set()} onInsert={insert} />)
    const when = screen.getByRole('textbox', { name: 'When' })
    const button = screen.getByRole('button', { name: 'Insert condition' })
    expect(screen.getByRole('status').textContent).toMatch(/Open a folder/)
    await replaceInput(user, when, 'destination:photos')
    expect(button).toHaveProperty('disabled', true)
    expect(screen.getByRole('alert')).toBeTruthy()
    await replaceInput(user, when, 'has:taken')
    await replaceInput(user, screen.getByRole('combobox', { name: 'Then' }), '{taken|date("invalid")}')
    expect(button).toHaveProperty('disabled', true)
    await replaceInput(user, screen.getByRole('combobox', { name: 'Then' }), 'photos/{taken|date("YYYY/MM")}/$&')
    await replaceInput(user, screen.getByRole('combobox', { name: 'Otherwise' }), 'photos/undated/$&')
    expect(button).toHaveProperty('disabled', false)
    await user.click(button)
    expect(insert).toHaveBeenCalledWith('{if has:taken}photos/{taken|date("YYYY/MM")}/$&{else}photos/undated/$&{end}')
  })

  it('previews the selected file’s fallback and prevents inserting an invalid destination', async () => {
    const user = userEvent.setup()
    const files = createDemoFiles()
    const notes = files.find(file => file.name === 'shoot-notes.md')!
    render(<ConditionPatternBuilder pattern="^.+$" replacement="" flags="" files={files} selectedIds={new Set([notes.id])} onInsert={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toBe('photos/other/shoot-notes.md')
    await replaceInput(user, screen.getByRole('textbox', { name: 'When' }), 'has:taken')
    await replaceInput(user, screen.getByRole('combobox', { name: 'Then' }), '{taken|date("YYYY/MM")}/$&')
    expect(screen.getByRole('status').textContent).toBe('photos/other/shoot-notes.md')
    await replaceInput(user, screen.getByRole('combobox', { name: 'Otherwise' }), '../$&')
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Insert condition' })).toHaveProperty('disabled', true)
  })
})

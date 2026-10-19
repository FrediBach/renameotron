// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TemplateLibrary } from './TemplateLibrary'
import { Dialog, DialogContent } from './ui/dialog'
import { TEMPLATES, type RenameTemplate } from '../lib/templates'

afterEach(cleanup)

// Templates saved before the library expansion have no keywords property.
const savedTemplate: RenameTemplate = {
  id: 'legacy-saved-rule',
  name: 'Café handoff',
  description: 'My original client naming rule.',
  category: 'Saved',
  pattern: 'archive-old',
  replacement: 'delivered-{name|lower}.{ext}',
  flags: 'gi',
}

function renderLibrary(savedTemplates: RenameTemplate[] = [savedTemplate]) {
  const onApply = vi.fn()
  render(<Dialog open><DialogContent><TemplateLibrary savedTemplates={savedTemplates} onApply={onApply} /></DialogContent></Dialog>)
  return { onApply }
}

describe('template library', () => {
  it('groups templates under accessible category headings and includes saved rules', () => {
    renderLibrary()

    expect(screen.getByRole('button', { name: 'All', pressed: true })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain(`${TEMPLATES.length + 1} templates`)
    for (const category of ['Photos', 'Documents', 'Organize', 'Saved']) {
      const group = within(screen.getByRole('region', { name: category }))
      expect(group.getByRole('heading', { level: 3, name: category })).toBeTruthy()
    }
    const savedGroup = within(screen.getByRole('region', { name: 'Saved' }))
    expect(savedGroup.getByRole('heading', { level: 4, name: savedTemplate.name })).toBeTruthy()
    expect(savedGroup.getByRole('button', { name: savedTemplate.name })).toBeTruthy()
  })

  it('combines categories with modifier search and clears the search without changing the category', async () => {
    const user = userEvent.setup()
    const { onApply } = renderLibrary()

    await user.click(screen.getByRole('button', { name: 'Photos' }))
    const search = screen.getByRole<HTMLInputElement>('textbox', { name: 'Search templates' })
    await user.click(search)
    await user.paste('pad with zeros')
    expect(screen.getByRole('button', { name: 'Photos', pressed: true })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Documents' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Saved' })).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/\d+ templates? found/)
    await user.click(screen.getByRole('button', { name: 'A fresh sequence' }))
    expect(onApply).toHaveBeenCalledExactlyOnceWith(TEMPLATES.find(template => template.id === 'photo-sequence'))

    await user.click(screen.getByRole('button', { name: 'Clear template search' }))
    expect(search.value).toBe('')
    expect(document.activeElement).toBe(search)
    expect(screen.getByRole('button', { name: 'Photos', pressed: true })).toBeTruthy()
    const photoGroup = within(screen.getByRole('region', { name: 'Photos' }))
    expect(photoGroup.getAllByRole('heading', { level: 4 })).toHaveLength(TEMPLATES.filter(template => template.category === 'Photos').length)
    expect(screen.queryByRole('region', { name: 'Documents' })).toBeNull()
  })

  it('shows an empty result and resets both category and search with Clear filters', async () => {
    const user = userEvent.setup()
    renderLibrary()

    await user.click(screen.getByRole('button', { name: 'Documents' }))
    const search = screen.getByRole<HTMLInputElement>('textbox', { name: 'Search templates' })
    await user.click(search)
    await user.paste('no-template-could-match-this-query')
    expect(screen.getByText('No templates found.')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('0 templates found')
    expect(screen.queryAllByRole('heading', { level: 4 })).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(search.value).toBe('')
    expect(document.activeElement).toBe(search)
    expect(screen.getByRole('button', { name: 'All', pressed: true })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Photos' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Saved' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain(`${TEMPLATES.length + 1} templates`)
  })

  it('searches an older saved rule by its pattern and applies the complete rule', async () => {
    const user = userEvent.setup()
    const { onApply } = renderLibrary()

    await user.click(screen.getByRole('button', { name: 'Saved' }))
    await user.click(screen.getByRole('textbox', { name: 'Search templates' }))
    await user.paste('ARCHIVE-OLD')
    expect(screen.getByRole('status').textContent).toContain('1 template found')
    await user.click(screen.getByRole('button', { name: 'Café handoff' }))
    expect(onApply).toHaveBeenCalledExactlyOnceWith(savedTemplate)
  })
})

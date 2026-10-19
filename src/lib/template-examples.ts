import { buildRenamePlan, type FileEntry } from './rename'
import type { RenameTemplate } from './templates'

const sampleNames: Record<string, string> = {
  'photo-sequence': 'IMG_1234.JPG',
  'remove-copy': 'Annual Report copy 2.pdf',
  'remove-number-prefix': '001 - Meeting notes.txt',
  'remove-draft': 'Meeting notes-draft.pdf',
  'remove-final': 'Meeting notes-final.pdf',
  'underscores-to-dashes': 'Summer__Trip.jpg',
  'clean-slug': 'Café Summer Trip.jpg',
  'ascii-filenames': 'Café notes.txt',
  'trim-whitespace': '  Meeting notes  .txt',
  'title-words': 'summer_trip-notes.txt',
  'dashes-to-spaces': 'Summer-Trip.jpg',
  'dots-to-spaces': 'Summer.Trip.jpg',
  'remove-square-brackets': '[final] Meeting notes.pdf',
  'remove-parentheses': 'Meeting notes (final).pdf',
  'shorten-name': 'A very long filename with enough detail to exceed the suggested title length for a shared project document.pdf',
  'collapse-separators': 'Summer__Trip.jpg',
  'number-tracks': 'Early_Morning.MP3',
  'document-extension': 'Meeting notes.markdown',
  'document-title': 'meeting_notes.pdf',
}

function sampleFile(name: string): FileEntry {
  return {
    id: `template-example:${name}`,
    name,
    path: name,
    size: 2_400_000,
    type: /\.jpe?g$/i.test(name) ? 'image/jpeg' : /\.pdf$/i.test(name) ? 'application/pdf' : 'text/plain',
    lastModified: Date.UTC(2025, 3, 12, 14, 5, 9),
    metadata: { taken: '2025-04-10T09:30:00Z', camera: 'Fujifilm X100 VI', width: 6240, height: 4160 },
  }
}

export function getTemplateExample(template: RenameTemplate) {
  const preferred = sampleNames[template.id] ?? (template.category === 'Photos' || template.pattern.includes('jpe?g')
    ? 'Summer Trip.JPG' : 'Meeting notes.pdf')
  // Saved rules can have arbitrary patterns. Try representative filenames,
  // including literal search text, and never invent a successful rename.
  const names = [...new Set([preferred, ...Object.values(sampleNames), template.pattern, `${template.pattern}.txt`])]
  for (const name of names) {
    const plan = buildRenamePlan([sampleFile(name)], template.pattern, template.replacement, template.flags)
    if (plan.error) return { from: preferred, to: 'Example unavailable (invalid rule)' }
    const row = plan.rows[0]
    if (row.status === 'ready') return { from: name, to: row.targetPath }
  }
  return { from: preferred, to: 'No rename for sample files' }
}

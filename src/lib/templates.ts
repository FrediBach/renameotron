export type TemplateCategory = 'Everyday' | 'Photos' | 'Documents' | 'Organize' | 'Saved'

export interface RenameTemplate {
  id: string
  name: string
  description: string
  pattern: string
  replacement: string
  flags: string
  category: TemplateCategory
}

export const TEMPLATE_CATEGORIES = ['All', 'Everyday', 'Photos', 'Documents', 'Organize'] as const

export const TEMPLATES: RenameTemplate[] = [
  { id: 'photo-sequence', name: 'A fresh sequence', description: 'Turn camera filenames into an orderly, numbered series.', pattern: '^IMG_(\\d+)\\.(jpg|png)$', replacement: 'studio-{index:3}.{ext}', flags: 'i', category: 'Photos' },
  { id: 'spaces-to-dashes', name: 'Spaces to dashes', description: 'Replace every run of spaces with a single dash.', pattern: ' +', replacement: '-', flags: 'g', category: 'Everyday' },
  { id: 'spaces-to-underscores', name: 'Spaces to underscores', description: 'Keep multiword filenames together with underscores.', pattern: ' +', replacement: '_', flags: 'g', category: 'Everyday' },
  { id: 'underscores-to-dashes', name: 'Underscores to dashes', description: 'Swap underscores for a cleaner separator.', pattern: '_+', replacement: '-', flags: 'g', category: 'Everyday' },
  { id: 'add-prefix', name: 'Add a prefix', description: 'Put project- at the beginning of each filename.', pattern: '^', replacement: 'project-', flags: '', category: 'Everyday' },
  { id: 'add-suffix', name: 'Add a suffix', description: 'Mark files as final, just before their extension.', pattern: '^(.*)(\\.[^.]+)$', replacement: '$1-final$2', flags: '', category: 'Everyday' },
  { id: 'remove-copy', name: 'Remove “copy”', description: 'Remove the copy suffix added by file managers.', pattern: ' copy(?: \\d+)?(?=\\.[^.]+$)', replacement: '', flags: 'i', category: 'Everyday' },
  { id: 'remove-number-prefix', name: 'Remove old numbering', description: 'Drop leading digits and their separator.', pattern: '^\\d+[ _.-]+', replacement: '', flags: '', category: 'Everyday' },
  { id: 'number-files', name: 'Number everything', description: 'Add a three-digit sequence before the existing name.', pattern: '^(.+)$', replacement: '{index:3}-$1', flags: '', category: 'Everyday' },
  { id: 'unique-id', name: 'Unique filenames', description: 'Use a stable UUID while keeping the extension.', pattern: '^.+$', replacement: '{uuid}.{ext}', flags: '', category: 'Everyday' },
  { id: 'photo-capture', name: 'By capture date', description: 'Name photos from their embedded capture time.', pattern: '^.+\\.(jpe?g|png|webp|heic)$', replacement: '{taken:YYYY-MM-DD}_{taken:HH-mm-ss}-{index:3}.{ext}', flags: 'i', category: 'Photos' },
  { id: 'photo-camera', name: 'Camera roll', description: 'Include the camera model and a numbered sequence.', pattern: '^.+\\.(jpe?g|png|webp|heic)$', replacement: '{camera}-{index:3}.{ext}', flags: 'i', category: 'Photos' },
  { id: 'photo-dimensions', name: 'Show dimensions', description: 'Append the pixel dimensions to each image name.', pattern: '^.+\\.(jpe?g|png|webp|gif)$', replacement: '{name}-{width}x{height}.{ext}', flags: 'i', category: 'Photos' },
  { id: 'photo-albums', name: 'Monthly photo albums', description: 'Create year/month folders from capture metadata.', pattern: '^.+\\.(jpe?g|png|webp|heic)$', replacement: '{taken:YYYY}/{taken:MM}/{name}.{ext}', flags: 'i', category: 'Photos' },
  { id: 'document-date', name: 'Date your documents', description: 'Prefix documents with their modification date.', pattern: '^.+\\.(pdf|docx?|txt|md|xlsx?)$', replacement: '{modified:YYYY-MM-DD}-{name}.{ext}', flags: 'i', category: 'Documents' },
  { id: 'document-version', name: 'Start at version one', description: 'Append a version label before the extension.', pattern: '^(.+)(\\.(?:pdf|docx?|txt|md))$', replacement: '$1-v01$2', flags: 'i', category: 'Documents' },
  { id: 'document-invoices', name: 'Invoice series', description: 'Name PDFs with a month and a running invoice number.', pattern: '^.+\\.pdf$', replacement: 'invoice-{modified:YYYY-MM}-{index:3}.pdf', flags: 'i', category: 'Documents' },
  { id: 'document-extension', name: 'Markdown extension', description: 'Change .markdown to the shorter .md extension.', pattern: '\\.markdown$', replacement: '.md', flags: 'i', category: 'Documents' },
  { id: 'organize-extension', name: 'Folders by extension', description: 'Group files into folders named after their extension.', pattern: '^.+\\.[^.]+$', replacement: '{ext}/{name}.{ext}', flags: '', category: 'Organize' },
  { id: 'organize-year', name: 'A yearly archive', description: 'Create year folders from file modification dates.', pattern: '^.+$', replacement: '{modified:YYYY}/$&', flags: '', category: 'Organize' },
  { id: 'organize-month', name: 'A monthly archive', description: 'Create year/month folders from modification dates.', pattern: '^.+$', replacement: '{modified:YYYY}/{modified:MM}/$&', flags: '', category: 'Organize' },
  { id: 'organize-delivery', name: 'Ready for delivery', description: 'Move files into a delivery folder with clean numbering.', pattern: '^.+\\.[^.]+$', replacement: 'delivery/{index:3}-{name}.{ext}', flags: '', category: 'Organize' },
]

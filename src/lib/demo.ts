import type { FileEntry } from './rename'

export function createDemoFiles(): FileEntry[] {
  const names = ['IMG_1042.jpg', 'IMG_1043.jpg', 'IMG_1044.jpg', 'IMG_1045.jpg', 'IMG_1046.jpg', 'IMG_1047.jpg', 'IMG_1048.jpg', 'IMG_1049.jpg', 'contact-sheet.pdf', 'shoot-notes.md', 'moodboard.png', 'readme.txt']
  return names.map((name, index) => ({
    id: `demo-${index}`, name, path: name,
    size: index < 8 ? 2400000 + ((index * 178643) % 2000000) : [820000, 2400, 1250000, 1200][index - 8],
    type: index < 8 ? 'image/jpeg' : ['application/pdf', 'text/markdown', 'image/png', 'text/plain'][index - 8],
    lastModified: new Date(2026, 9, 12, 10, 24 + index).getTime(),
    metadata: index < 8 ? { taken: new Date(2026, 9, 12, 10, 24 + index).toISOString(), camera: 'Fujifilm X100VI', width: 6240, height: 4160 } : {},
  }))
}

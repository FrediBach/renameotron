# renameotron

A local-first batch file renamer for **renameotron.com**, built as a working proof of concept with Vite, React, TypeScript, Tailwind CSS, and shadcn-style Radix UI components. The interface takes its cues from Dieter Rams: restrained color, clear hierarchy, and a focus on the task.

## Run it

Use Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite. The app starts with 12 sample files; demo renames never touch your disk and can be undone. Choose **Open folder** to work with real files in desktop Chrome or Edge.

```sh
npm test       # Rename engine, filesystem safety, and UI interaction tests
npm run build # TypeScript check + production build in dist/
```

This repository is a local POC. It has not been deployed or connected to the renameotron.com domain. The production `dist/` folder can be served by any static host over HTTPS.

## What works

- Live from/to preview, filename search, match filtering, and individual file selection.
- Regex101-inspired background highlighting for regex syntax, replacement references, and matched filename portions. Capture groups keep the same color across both editors and the preview, using exact regex match indices, including nested and global matches.
- Replacement metadata tokens share their background colors with the values they generate in the new-name preview (for example, `{ext}` and `jpg`). Literal text stays plain, even when it equals a metadata value.
- Keyboard metadata autocomplete and capture groups (`$1`, `$2`, `$&`, named captures); click a colored group chip to insert its reference into the replacement.
- 22 built-in templates, searchable by category, plus custom templates saved in this browser.
- Optional recursive scanning, destination subfolder creation, sequences, and stable UUIDs.
- Basic file metadata and embedded photo EXIF, processed in the browser with `exifr`.
- Explicit review before applying native rename or copy-and-delete, with partial-result reporting and downloadable session receipts.
- Responsive layout, keyboard navigation, reduced-motion support, accessible Radix dialogs, checkboxes, and switches.

No files are uploaded. There is no server, analytics, or runtime third-party network dependency. Custom naming rules are saved to local storage; file handles and rename history remain in memory.

## Naming rules

Regexes match the **filename including its extension**, not the full path. A plain replacement filename stays in the source file's folder. A replacement containing `/` is relative to the selected root folder.

| Token | Meaning |
| --- | --- |
| `{name}` | Original filename without its last extension |
| `{ext}` | Extension without the dot |
| `{index}` / `{index:3}` | Selected-match sequence, starting at 1; optional zero padding |
| `{uuid}` | UUID that remains stable while editing the preview |
| `{modified:YYYY-MM-DD}` | Filesystem modification date |
| `{taken:YYYY-MM-DD}` | Photo capture date from embedded EXIF |
| `{camera}` | EXIF camera model |
| `{width}` / `{height}` | Image dimensions when embedded metadata exposes them |
| `{size}` | File size in bytes |
| `{type}` | Browser-reported MIME type; `/` becomes a folder separator |

Dates use UTC and support `YYYY`, `MM`, `DD`, `HH`, `mm`, and `ss`. EXIF timestamps often lack timezone information; the parser's interpretation is used. Missing metadata is flagged instead of silently producing an incomplete name. Unsupported or damaged image formats may not expose dimensions. Audio tags, PDF document properties, OS creation times, Finder tags, and extended attributes are outside this POC's scope.

For example, match `^IMG_(\d+)\.(jpg|png)$` and replace with `studio-{index:3}.{ext}`. To organize by date, use `{modified:YYYY}/{modified:MM}/{name}.{ext}`.

## Filesystem behavior and limits

Local access requires a secure context (HTTPS or localhost), a user gesture, and directory permission. Other browsers can use the demo, but may not support the local folder picker. Native `FileSystemFileHandle.move()` availability varies; a present method is not proof that local moves work. Native failures are reported without silently switching to another method.

**Copy & delete is an explicit alternative.** It writes and closes the new file, verifies its byte length, rechecks the source, and only then deletes the source. It needs additional disk space and can change filesystem timestamps and attributes. Embedded metadata remains in the copied bytes. Verification checks length, not a content hash.

The engine blocks duplicate names, unsafe paths, missing metadata, occupied destinations, and dependent/case-only renames. Before writing, the executor rechecks the entire batch against disk, including destination directories and stale sources. A destination hidden from the current preview (for example inside an unscanned subfolder) may be rejected during this final check.

Batches are **not transactions**: execution stops at the first failure, earlier successes remain, and failed copies may leave a destination file. No automatic undo is provided for real files. The activity receipt records every attempted operation. Avoid editing the same folder in another application during a batch: the browser API provides neither an exclusive create nor an atomic “rename only if destination is absent,” so external changes between checks and writes cannot be fully prevented.

Scanning is limited to 10,000 files, 20,000 directory entries, and 32 directory levels, and stops with an error rather than silently truncating the listing. Preview regexes use the JavaScript engine on the UI thread; pathological expressions can stall the interface, so use bounded patterns on trusted filenames for this POC. Large-folder virtualization and worker-based regex timeouts are future work.

API references: [Chrome File System Access guide](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access), [WHATWG move proposal](https://github.com/whatwg/fs/blob/main/proposals/MovingNonOpfsFiles.md), [exifr](https://github.com/MikeKovarik/exifr).

## Structure

- `src/App.tsx` — application workflow and responsive workspace
- `src/components/PatternInput.tsx` — highlighted inputs and autocomplete
- `src/components/ui/` — shadcn conventions with accessible Radix primitives
- `src/lib/rename.ts` — pure rename planning and validation
- `src/lib/filesystem.ts` — directory scanning and checked execution
- `src/lib/templates.ts` — curated template library

The `@/` alias and `components.json` are configured for adding further shadcn components.

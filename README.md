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
npm run doctor -- --verbose # React Doctor: full-project diagnostics
```

React Doctor is installed as a development dependency. The `doctor` script disables telemetry and remote scoring while retaining diagnostics. See the [React Doctor CLI reference](https://www.react.doctor/docs/reference/cli-reference) for scan options. The full-project scan currently reports no issues, without rule suppressions. Regression tests cover autocomplete selection resets, metadata dialog reopening, keyboard row actions, and clearing preview filters while preserving column preferences.

The production `dist/` folder can be served by any static host over HTTPS.

## Deployment

Import this repository into Vercel and connect **renameotron.com** as the production domain. `vercel.json` configures the Vite framework, `npm ci`, `npm run build`, and the `dist/` output directory, plus basic security headers and immutable caching for Vite's hashed assets. The app has only the root route, so no catch-all rewrite is needed; missing assets and unknown URLs retain their 404 responses. Use Node.js 22.12 or newer in the project settings. Configuration reference: [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json).

The initial HTML includes canonical, Open Graph, and Twitter card metadata for `https://renameotron.com/`, with a 1200 × 630 PNG social image. `public/` also contains the web app manifest, app icons, Apple touch icon, `robots.txt`, and a single-page sitemap. The manifest supports standalone display; it does not add offline support or a service worker.

To regenerate the social image and icons from the existing robot favicon, run `npm run generate:brand` and commit the generated assets. The editable layout is in `scripts/generate-brand-assets.mjs`; Sharp is used only for asset generation and is not bundled into the app. If the production domain changes, update the URLs in `index.html`, `public/robots.txt`, `public/sitemap.xml`, and the image generator.

## What works

- Live from/to preview with configurable metadata columns, per-column sorting, combined column filters, global metadata search, and individual file selection.
- Regex101-inspired background highlighting for regex syntax, replacement references, and matched filename portions. Capture groups keep the same color across both editors and the preview, using exact regex match indices, including nested and global matches.
- Replacement metadata tokens share their background colors with the values they generate in the new-name preview (for example, `{ext}` and `jpg`). Literal text stays plain, even when it equals a metadata value.
- Keyboard metadata autocomplete and capture groups (`$1`, `$2`, `$&`, named captures); click a colored group chip to insert its reference into the replacement.
- 90 built-in templates in eight task groups, with examples of all 18 modifiers, plus custom templates saved in this browser. Search combines words across names, descriptions, keywords, metadata, modifier names, and patterns; category filters narrow the results further.
- **Share** copies a link that restores the find pattern, replacement, regex options, and subfolder setting. If clipboard access is unavailable, the link is shown for manual copying. The setup stays in the URL fragment; files and metadata are not included.
- Optional recursive scanning, destination subfolder creation, sequences, and stable UUIDs.
- Basic file metadata and embedded photo EXIF, processed in the browser with `exifr`.
- Chain metadata modifiers for text cleanup, number and date formatting, MIME subtypes, and missing-value fallbacks; calculated image metadata includes aspect ratios, dimensions, megapixels, and orientation.
- Click a file row (or focus its filename and press Enter) to inspect every supported metadata field, its value, and the corresponding naming token. Click an available token to append it to the name pattern. Missing fields are marked; sequence values follow the current selected matches.
- Explicit review before applying native rename or copy-and-delete, with partial-result reporting and downloadable session receipts.
- Responsive layout, keyboard navigation, reduced-motion support, accessible Radix dialogs, checkboxes, and switches.

No files are uploaded. There is no server, analytics, or runtime third-party network dependency. Custom naming rules and preview column preferences are saved to local storage; file handles and rename history remain in memory.

## Preview columns and search

Use **Columns** to add or remove any supported metadata field, including calculated image details, sequence numbers, and extra fields available in a file's metadata. Move columns left or right in the picker. Column choices, order, widths, and sorting are remembered in this browser; **Reset columns** restores From, To, and Size.

Drag a header edge to resize it, or focus the edge and use the arrow keys (Shift for larger steps). Double-click an edge to restore its default width. Click any column heading to cycle through ascending, descending, and original order. Numbers and dates sort by value; missing metadata stays last. Sorting and searching change only the view, so rename sequence numbers and destinations remain stable.

The search box checks names and all available metadata, including hidden columns. Turn on **Filters** to enter a different search in each visible column, for example Camera contains `Fujifilm` and From contains `1045`. Searches ignore case, and a file must match every active filter as well as the global search. Collapsing the filters keeps them active; removing a column clears its filter. **Clear filters** restores the full view. The header checkbox selects or deselects only the visible files; renaming still applies to all selected matches, including those outside the current search.

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
| `{dimensions}` | Width and height together, for example `6240x4160` |
| `{aspect}` | Reduced width-to-height ratio using a filename-safe separator, for example `3x2` |
| `{megapixels}` | Width × height divided by 1,000,000, rounded to two decimal places |
| `{orientation}` | `landscape`, `portrait`, or `square`, based on width and height |
| `{size}` | File size in bytes |
| `{type}` | Browser-reported MIME type; `/` becomes a folder separator |

Dates use UTC and support `YYYY`, `MM`, `DD`, `HH`, `mm`, and `ss`. EXIF timestamps often lack timezone information; the parser's interpretation is used. Missing metadata is flagged unless you supply a `default(...)` modifier. Unsupported or damaged image formats may not expose dimensions. Audio tags, PDF document properties, OS creation times, Finder tags, and extended attributes are outside this POC's scope.

For example, match `^IMG_(\d+)\.(jpg|png)$` and replace with `studio-{index|pad(3)}.{ext|lower}`. To organize by date while preserving the original filename (including files without extensions), match `^.+$` and use `{modified|date("YYYY/MM")}/$&`.

### Metadata modifiers

Append modifiers inside a token with `|`. They run from left to right, so their order matters. The existing date and index formats still work, including when followed by modifiers:

```text
{name|trim|lower|replace(" ","-")}.{ext|lower}
{modified:YYYY-MM-DD|prefix("shoot-")}-{index:3}.{ext}
{name|slug}-{size|bytes|whitespace("-")}.{ext|lower}
{camera|default("unknown-camera")|slug}-{aspect}-{megapixels|round(1)}MP.{ext}
```

| Modifier | Use |
| --- | --- |
| `lower` / `upper` / `title` | Change text casing |
| `trim` | Remove leading and trailing whitespace |
| `replace("old","new")` | Replace every occurrence of a literal string |
| `whitespace("-")` | Replace each run of whitespace with the supplied separator |
| `slug` | Remove accents and make a lowercase, dash-separated name; preserve non-Latin letters |
| `ascii` | Fold common accented Latin characters into ASCII and remove remaining non-ASCII characters |
| `prefix("photo-")` / `suffix("-edited")` | Add text before or after the value |
| `truncate(40)` | Keep the first 40 Unicode code points; accepts 0–4096 |
| `pad(3)` | Pad a value with leading zeros to at least three characters; accepts 1–128 |
| `bytes` | Format a byte count in decimal units, for example `2400000` → `2.4 MB` |
| `compact` | Abbreviate large numbers, for example `68000` → `68k` |
| `round(2)` | Round a number to at most two decimal places; accepts 0–12 |
| `mime` | Keep the MIME subtype, removing `x-` and `+` suffixes: `image/jpeg` → `jpeg`, `image/svg+xml` → `svg` |
| `default("unknown")` | Provide a fallback for unavailable or empty metadata |
| `date("YYYY-MM-DD")` | Format a date in UTC with the same fields as the existing colon syntax |

Use single or double quotes for text arguments. Quoted text can contain commas, pipes, and braces; escape quotes or backslashes with `\`, and use `\t`, `\n`, or `\uXXXX` for escaped characters. `replace(" ","-")` replaces ordinary spaces; `whitespace("-")` also handles tabs and other whitespace and collapses consecutive whitespace into one separator. Replacement text is literal: regex patterns, metadata tokens, and capture references such as `$1` are not expanded inside modifier arguments.

Put `default(...)` before the transformations you want applied to the fallback, for example `{camera|default("Unknown Camera")|slug}`. It handles unavailable source metadata (including invalid dates or calculated dimensions) and empty values, but does not hide invalid tokens, malformed arguments, or failed transformations. Zero remains a valid value.

Use `date(...)` before text modifiers to preserve the original timestamp, for example `{taken|date("YYYY-MM-DD_HH-mm-ss")|prefix("photo-")}`. A preceding text modifier or colon format has already converted the date to text. Chains support up to 32 modifiers.

Calculated image tokens require both width and height. Modifiers do not bypass destination validation: a `/` in their output creates folders, and invalid paths, reserved names, and duplicate destinations are still rejected.

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
- `src/lib/metadata-modifiers.ts` — modifier catalog, argument parsing, and transformations
- `src/lib/metadata-pattern.ts` — shared token scanner for modifiers and quoted arguments
- `src/lib/filesystem.ts` — directory scanning and checked execution
- `src/lib/templates.ts` — curated template library and categories
- `src/lib/template-search.ts` — search across templates, metadata, and modifiers
- `src/components/TemplateLibrary.tsx` — grouped, searchable template picker
- `src/components/PreviewTable.tsx` — column management, resizing, and table controls
- `src/lib/preview-table.ts` — metadata column values, filtering, and stable sorting

The `@/` alias and `components.json` are configured for adding further shadcn components.

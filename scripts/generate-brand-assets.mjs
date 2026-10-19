import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const publicDir = new URL('../public/', import.meta.url)
const logo = await readFile(new URL('favicon.svg', publicDir), 'utf8')
const robot = logo.replace(/<svg[^>]*>/, '').replace('</svg>', '')
const svg = (width, height, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
const render = (source, filename) => sharp(Buffer.from(source)).png().toFile(new URL(filename, publicDir).pathname)

for (const [filename, size, scale] of [
  ['icon-192.png', 192, 4.5],
  ['icon-512.png', 512, 12],
  ['icon-maskable-512.png', 512, 10],
  ['apple-touch-icon.png', 180, 4],
]) {
  const offset = (size - 32 * scale) / 2
  await render(svg(size, size, `<rect width="${size}" height="${size}" fill="#f2f2ee"/><g transform="translate(${offset} ${offset}) scale(${scale})" shape-rendering="crispEdges">${robot}</g>`), filename)
}

const card = svg(1200, 630, `
  <rect width="1200" height="630" fill="#f2f2ee"/>
  <g transform="translate(64 48) scale(2)" shape-rendering="crispEdges">${robot}</g>
  <g font-family="Helvetica Neue, Helvetica, Arial, sans-serif" fill="#292c26">
    <text x="145" y="94" font-size="38" font-weight="700" letter-spacing="-1.5">renameotron<tspan fill="#e96636">.</tspan></text>
    <text x="68" y="210" font-size="68" font-weight="700" letter-spacing="-2">A little order</text>
    <text x="68" y="286" font-size="68" font-weight="700" letter-spacing="-2">for your files.</text>
    <text x="70" y="337" font-size="24" fill="#747d68">Batch renaming. Live previews. Everything stays on your device.</text>
    <rect x="68" y="385" width="1064" height="135" rx="10" fill="#fbfbf8" stroke="#dcded5"/>
    <g font-family="Menlo, Consolas, monospace">
      <text x="98" y="423" font-size="14" fill="#85877e" letter-spacing="2">FROM</text>
      <text x="98" y="477" font-size="30">IMG_1045.JPG</text>
      <text x="668" y="423" font-size="14" fill="#85877e" letter-spacing="2">TO</text>
      <text x="668" y="477" font-size="30" fill="#58644a">summer-001.jpg</text>
    </g>
    <path d="M548 457h48m-13-13 14 13-14 13" fill="none" stroke="#e96636" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="75" cy="570" r="5" fill="#7e8e63"/>
    <text x="92" y="577" font-size="19" fill="#747d68">Local files. Thoughtfully renamed.</text>
    <text x="1132" y="577" font-size="19" fill="#747d68" text-anchor="end">renameotron.com</text>
  </g>
`)
await writeFile(new URL('og-image.svg', publicDir), card)
await render(card, 'og-image.png')
console.log('Generated OG image and app icons in public/.')

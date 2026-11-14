// Makes the app icons in public/icons/ from the favicon's speech bubble (public/favicon.svg):
//   node scripts/make-icons.ts
// Run again after changing the favicon, and commit the PNGs. Home screens (iOS, Android)
// and the notification badge need PNGs; browsers use the SVG favicon.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const out = join(import.meta.dirname, '..', 'public', 'icons')
mkdirSync(out, { recursive: true })

const ink = '#201d1a'
const paper = '#f4f0e8'
const bubble = (fill: string, mark: string) =>
  `<path d="M8 6h48a4 4 0 0 1 4 4v32a4 4 0 0 1-4 4H26L12 58V46H8a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z" fill="${fill}"/>` +
  `<path d="M29 13h6l-1 18h-4z" fill="${mark}"/><circle cx="32" cy="37" r="3.2" fill="${mark}"/>`

// `scale`: how much of the square the bubble fills (maskable icons keep to the middle 80%).
function icon(scale: number, background: string | null, fill: string, mark: string): Buffer {
  const offset = (64 - 64 * scale) / 2
  const back = background ? `<rect width="64" height="64" fill="${background}"/>` : ''
  // A transparent mark has to be cut out of the bubble with a mask: painting
  // "transparent" over it would leave the bubble as it was.
  const cut = mark === 'transparent'
  const mask = cut
    ? `<mask id="m"><rect width="64" height="64" fill="#fff"/>${bubble('none', '#000')}</mask>`
    : ''
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${back}` +
      `<g transform="translate(${offset} ${offset + 1.5 * scale}) scale(${scale})">${mask}` +
      `<g${cut ? ' mask="url(#m)"' : ''}>${bubble(fill, cut ? 'none' : mark)}</g></g></svg>`,
  )
}

const icons: [file: string, size: number, svg: Buffer][] = [
  ['icon-192.png', 192, icon(0.84, paper, ink, paper)],
  ['icon-512.png', 512, icon(0.84, paper, ink, paper)],
  ['icon-maskable-512.png', 512, icon(0.62, paper, ink, paper)],
  // iOS rounds the corners itself and wants no transparency.
  ['apple-touch-icon.png', 180, icon(0.76, paper, ink, paper)],
  // Android's status bar badge: only the alpha channel counts, so white on transparent,
  // with the exclamation mark cut out.
  ['badge-96.png', 96, icon(0.9, null, '#ffffff', 'transparent')],
]

for (const [file, size, svg] of icons) {
  await sharp(svg, { density: 72 * (size / 64) })
    .resize(size, size)
    .png({ compressionLevel: 9, palette: true })
    .toFile(join(out, file))
  console.log(`public/icons/${file}`)
}

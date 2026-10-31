import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createCanvas,
  GlobalFonts,
  loadImage,
  type Image,
  type SKRSContext2D,
} from '@napi-rs/canvas'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { blurtMaxLength } from './limits.ts'
import { cardColorOf, type CardColorId } from './card-colors.ts'
import type { Avatar } from './avatar.ts'
import { AvatarSvg } from './templates/avatar.ts'
import { pictureSvg } from './picture.ts'

export const OG_TEMPLATE_VERSION = 2
export const OG_AVATAR_VERSION = 1
export const OG_WIDTH = 1200
export const OG_HEIGHT = 630
export const OG_MIN_FONT_SIZE = 30
export const OG_MAX_FONT_SIZE = 240
const OG_MIN_WHOLE_FONT_SIZE = 60

export type OgInput = {
  text: string
  username: string
  avatar: Avatar | null
  style?: 'post' | 'blurt'
  // The background (src/card-colors.ts); null or missing is the default. The red BLURT card ignores it.
  color?: CardColorId | null
  // The blurt has a picture: the card is drawn on top of it, and is a JPEG, not a PNG.
  picture?: boolean
}

// JPEG quality of cards drawn on a picture: well under the share sites' size limits.
export const OG_JPEG_QUALITY = 85

export type TextLayout = {
  fontSize: number
  lines: string[]
  width: number
  height: number
}

const fontDir = join(import.meta.dirname, '..', 'assets', 'fonts')
GlobalFonts.registerFromPath(join(fontDir, 'Lato-Black.ttf'), 'Lato Black')
GlobalFonts.registerFromPath(join(fontDir, 'NotoColorEmoji.ttf'), 'Noto Color Emoji')
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const measureContext = createCanvas(1, 1).getContext('2d')
const textBox = { x: 500, y: 85, width: 650, height: 540 }
const lineHeightFactor = 1.05
const avatarFallback: Avatar = {
  headWidth: 'regular',
  skin: '#f1c27d',
  hairType: 'tuft',
  hairColor: '#2c222b',
  eyeType: 'classic',
  eyeColor: '#ffffff',
  pupilColor: '#000000',
  toothType: 'two',
  toothColor: '#ffffff',
}

function normalizedAvatar(avatar: Avatar | null, version: number): string {
  if (!avatar) {
    return JSON.stringify(['default', version])
  }
  return JSON.stringify([
    version,
    avatar.headWidth,
    avatar.skin,
    avatar.hairType,
    avatar.hairColor,
    avatar.eyeType,
    avatar.eyeColor,
    avatar.pupilColor,
    avatar.toothType,
    avatar.toothColor,
  ])
}

// The card of a blurt (the red one when it says just BLURT) or of a profile's bio.
export function blurtOgInput(
  blurt: {
    text: string
    username: string
    avatar: Avatar | null
    picture?: object | null
  },
  color: CardColorId | null,
): OgInput {
  return {
    text: blurt.text,
    username: blurt.username,
    avatar: blurt.avatar,
    style: blurt.text === 'BLURT' ? 'blurt' : 'post',
    color,
    picture: Boolean(blurt.picture),
  }
}

export function ogHash(
  input: OgInput,
  templateVersion = OG_TEMPLATE_VERSION,
  avatarVersion = OG_AVATAR_VERSION,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.text,
        input.username,
        normalizedAvatar(input.avatar, avatarVersion),
        input.style ?? 'post',
        input.style === 'blurt' ? null : cardColorOf(input.color).id,
        templateVersion,
        // Only when there is one, so the hashes of cards without a picture stay as they were.
        ...(input.picture ? ['picture-band'] : []),
      ]),
    )
    .digest('hex')
}

function measureText(value: string, fontSize: number): number {
  measureContext.font = `${fontSize}px "Lato Black", "Noto Color Emoji"`
  return measureContext.measureText(value).width
}

function wrapParagraph(paragraph: string, fontSize: number, width: number): string[] {
  const words = paragraph.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return ['']
  }
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (measureText(candidate, fontSize) <= width) {
      line = candidate
      continue
    }
    if (line) {
      lines.push(line)
      line = ''
    }
    for (const { segment } of segmenter.segment(word)) {
      const part = line + segment
      if (line && measureText(part, fontSize) > width) {
        lines.push(line)
        line = segment
      } else {
        line = part
      }
    }
  }
  if (line) {
    lines.push(line)
  }
  return lines
}

export function wrapOgText(text: string, fontSize: number, width = textBox.width): string[] {
  return wrapParagraph(text.replace(/\s+/g, ' ').trim(), fontSize, width)
}

function wrapPreservedOgText(text: string, fontSize: number, width: number): string[] {
  const lines: string[] = []
  let blank = false
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!paragraph.trim()) {
      if (!blank) {
        lines.push('')
      }
      blank = true
      continue
    }
    lines.push(...wrapParagraph(paragraph, fontSize, width))
    blank = false
  }
  return lines
}

export function measureOgText(text: string, fontSize: number): number {
  return measureText(text, fontSize)
}

export function fitOgText(
  text: string,
  { width = textBox.width, height = textBox.height, maxFontSize = OG_MAX_FONT_SIZE } = {},
): TextLayout {
  const words = text.split(/s+/).filter(Boolean)
  // `whole`: only sizes at which no word has to be broken across lines.
  const fit = (
    wrap: (text: string, fontSize: number, width: number) => string[],
    whole: boolean,
  ) => {
    const fits = (fontSize: number) => {
      const lines = wrap(text, fontSize, width)
      return {
        fontSize,
        lines,
        width,
        height: lines.length * fontSize * lineHeightFactor,
      }
    }
    let low = OG_MIN_FONT_SIZE
    let high = maxFontSize
    let best = fits(low)
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const candidate = fits(middle)
      if (
        candidate.height <= height &&
        (!whole || words.every((word) => measureText(word, middle) <= width))
      ) {
        best = candidate
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    return best
  }
  const layout = (whole: boolean) => {
    const preserved = fit(wrapPreservedOgText, whole)
    const collapsed = fit(wrapOgText, whole)
    return collapsed.fontSize > preserved.fontSize * 1.25 ? collapsed : preserved
  }
  // Break a word only when keeping words whole would make the text tiny.
  const whole = layout(true)
  return whole.fontSize >= OG_MIN_WHOLE_FONT_SIZE ? whole : layout(false)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

// The face area, left of the text: equal to the margin at the right of the card.
const faceBox = { x: 50, y: 95, width: 400, height: 500 }

async function rasterize(svg: string, width: number): Promise<Image> {
  const [viewWidth, viewHeight] = /viewBox="\S+ \S+ (\S+) (\S+)"/.exec(svg)!.slice(1).map(Number)
  const height = (width * viewHeight) / viewWidth
  // Without width and height an SVG is rasterized at a small default size, and scaling
  // that up is what made the avatar blurry. Rasterizing at the size it is drawn is crisp.
  return loadImage(Buffer.from(svg.replace('<svg ', `<svg width="${width}" height="${height}" `)))
}

// Draws the avatar as large as fits in `faceBox`, with the painted part (not the SVG's
// padding) centred in it, so the margin to the left of the head matches the one above and below.
async function drawFace(
  context: SKRSContext2D,
  svg: string,
  box: { x: number; y: number; width: number; height: number } = faceBox,
): Promise<void> {
  const probeWidth = 600
  const probe = await rasterize(svg, probeWidth)
  const probeCanvas = createCanvas(probe.width, probe.height)
  const probeContext = probeCanvas.getContext('2d')
  probeContext.drawImage(probe, 0, 0)
  const { data } = probeContext.getImageData(0, 0, probe.width, probe.height)
  let [left, top, right, bottom] = [probe.width, probe.height, -1, -1]
  for (let y = 0; y < probe.height; y++) {
    for (let x = 0; x < probe.width; x++) {
      if (data[(y * probe.width + x) * 4 + 3] > 8) {
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
  }
  if (right < left || bottom < top) {
    return // nothing painted (cannot happen with a valid avatar): a card without a face
  }
  const paintedWidth = right - left + 1
  const paintedHeight = bottom - top + 1
  const scale = Math.min(box.width / paintedWidth, box.height / paintedHeight)
  const face = await rasterize(svg, Math.round(probeWidth * scale))
  const factor = face.width / probe.width
  context.drawImage(
    face,
    box.x + (box.width - paintedWidth * factor) / 2 - left * factor,
    box.y + (box.height - paintedHeight * factor) / 2 - top * factor,
  )
}

// The picture fills the card (cropped to its shape, like CSS `object-fit: cover`), unveiled.
async function drawPicture(context: SKRSContext2D, shapes: Uint8Array): Promise<void> {
  const svg = pictureSvg(shapes)
  const [width, height] = /viewBox="0 0 (\S+) (\S+)"/.exec(svg)!.slice(1).map(Number)
  const scale = Math.max(OG_WIDTH / width, OG_HEIGHT / height)
  const image = await rasterize(svg, Math.ceil(width * scale))
  context.drawImage(image, (OG_WIDTH - image.width) / 2, (OG_HEIGHT - image.height) / 2)
}

// Over a picture: a small face top left, the text in a translucent band along the bottom.
async function drawOnPicture(
  context: SKRSContext2D,
  input: OgInput,
  faceSvg: string,
): Promise<void> {
  const margin = 20
  const padding = 16
  const bandWidth = OG_WIDTH - 2 * margin
  const font = fitOgText(input.text, {
    width: bandWidth - 2 * padding,
    height: 190,
    maxFontSize: 44,
  })
  const lineHeight = font.fontSize * lineHeightFactor
  const bandHeight = font.lines.length * lineHeight + 2 * padding
  const bandTop = OG_HEIGHT - margin - bandHeight
  const badge = { x: margin, y: margin, width: 90, height: 90 }
  const pill = (x: number, y: number, width: number, height: number) => {
    context.fillStyle = 'rgba(0, 0, 0, 0.6)'
    context.beginPath()
    context.roundRect(x, y, width, height, 12)
    context.fill()
  }
  pill(badge.x, badge.y, badge.width, badge.height)
  await drawFace(context, faceSvg, {
    x: badge.x + 6,
    y: badge.y + 6,
    width: badge.width - 12,
    height: badge.height - 12,
  })
  context.font = '900 22px "Lato Black"'
  context.textAlign = 'left'
  const name = `@${input.username}`
  const nameWidth = Math.min(context.measureText(name).width, 500)
  pill(badge.x + badge.width + 10, badge.y, nameWidth + 28, 40)
  context.fillStyle = '#ffbd59'
  context.fillText(name, badge.x + badge.width + 24, badge.y + 28, 500)
  pill(bandWidth + margin - 132, badge.y, 132, 40)
  context.font = '900 18px "Lato Black"'
  context.textAlign = 'right'
  context.fillStyle = '#ffbd59'
  context.fillText('blurt.trade', OG_WIDTH - margin - 14, badge.y + 27)
  pill(margin, bandTop, bandWidth, bandHeight)
  context.font = `900 ${font.fontSize}px "Lato Black", "Noto Color Emoji"`
  context.textAlign = 'left'
  context.fillStyle = '#f9f5ef'
  font.lines.forEach((line, index) => {
    context.fillText(
      line,
      margin + padding,
      bandTop + padding + font.fontSize * 0.85 + index * lineHeight,
      bandWidth - 2 * padding,
    )
  })
}

async function canvasFor(
  input: OgInput,
  debug = false,
  picture?: Uint8Array,
): Promise<ReturnType<typeof createCanvas>> {
  const special = input.style === 'blurt'
  const font = fitOgText(input.text)
  const avatar = input.avatar ?? avatarFallback
  const faceSvg = renderToString(
    h(AvatarSvg, {
      avatar,
      size: 'large',
      openMouth: true,
    }),
  )
  const canvas = createCanvas(OG_WIDTH, OG_HEIGHT)
  const context = canvas.getContext('2d')
  const colors = special ? { from: '#f00020', to: '#a90017' } : cardColorOf(input.color)
  const gradient = context.createLinearGradient(0, 0, OG_WIDTH, OG_HEIGHT)
  gradient.addColorStop(0, colors.from)
  gradient.addColorStop(1, colors.to)
  context.fillStyle = gradient
  context.fillRect(0, 0, OG_WIDTH, OG_HEIGHT)
  if (picture) {
    await drawPicture(context, picture)
    await drawOnPicture(context, input, faceSvg)
    return canvas
  }
  const accent = special ? '#ffffff' : '#ffbd59'
  context.font = '900 25px "Lato Black"'
  context.textAlign = 'left'
  context.fillStyle = accent
  context.fillText(`@${input.username}`, textBox.x, 70, textBox.width)
  context.font = '900 18px "Lato Black"'
  context.textAlign = 'right'
  context.fillText('blurt.trade', 1155, 70)
  await drawFace(context, faceSvg)
  context.font = `900 ${font.fontSize}px "Lato Black", "Noto Color Emoji"`
  context.textAlign = 'left'
  context.fillStyle = '#f9f5ef'
  const firstBaseline = textBox.y + (textBox.height - font.height) / 2 + font.fontSize * 0.85
  font.lines.forEach((line, index) => {
    context.fillText(
      line,
      textBox.x,
      firstBaseline + index * font.fontSize * lineHeightFactor,
      textBox.width,
    )
  })
  if (debug) {
    context.strokeStyle = '#00eaff'
    context.lineWidth = 2
    context.strokeRect(textBox.x, textBox.y, textBox.width, textBox.height)
    context.strokeRect(faceBox.x, faceBox.y, faceBox.width, faceBox.height)
    context.font = '900 18px "Lato Black"'
    context.fillStyle = '#00eaff'
    context.fillText(`${font.fontSize}px`, 1155, 32)
  }
  return canvas
}

export async function renderOgPng(input: OgInput, debug = false): Promise<Buffer> {
  return (await canvasFor(input, debug)).toBuffer('image/png')
}

// The card of a blurt with a picture: drawn on the picture (its stored shapes), as a JPEG.
export async function renderOgJpeg(
  input: OgInput,
  picture: Uint8Array,
  debug = false,
): Promise<Buffer> {
  return (await canvasFor(input, debug, picture)).toBuffer('image/jpeg', OG_JPEG_QUALITY)
}

const cacheDir = process.env.OG_CACHE_DIR || join(import.meta.dirname, '..', 'og-cache')
const inFlight = new Map<string, Promise<Buffer>>()

export async function cachedOgPng(
  cacheKey: string,
  generate: () => Buffer | Promise<Buffer>,
  extension: 'png' | 'jpg' = 'png',
): Promise<Buffer> {
  const path = join(cacheDir, `${cacheKey}.${extension}`)
  try {
    return await readFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
  const pending = inFlight.get(cacheKey)
  if (pending) {
    return pending
  }
  const creating = (async () => {
    await mkdir(cacheDir, { recursive: true })
    const image = await generate()
    const temporary = `${path}.${randomUUID()}.tmp`
    await writeFile(temporary, image, { flag: 'wx' })
    await rename(temporary, path)
    return image
  })()
  inFlight.set(cacheKey, creating)
  try {
    return await creating
  } finally {
    inFlight.delete(cacheKey)
  }
}

export const debugExamples: { id: string; label: string; input: OgInput }[] = [
  {
    id: 'short',
    label: '3 characters',
    input: { text: 'Hey', username: 'poet', avatar: null },
  },
  {
    id: 'sentence',
    label: 'A sentence',
    input: {
      text: 'A regular sentence, with enough words to show how the type is wrapped.',
      username: 'poet',
      avatar: avatarFallback,
    },
  },
  {
    id: 'maximum',
    label: 'Maximum length',
    input: {
      text: 'W'.repeat(blurtMaxLength),
      username: 'poet',
      avatar: avatarFallback,
    },
  },
  {
    id: 'emoji',
    label: 'Emoji',
    input: {
      text: '🌈✨🗣️ This is blurted with feeling! 💥🎉',
      username: 'poet',
      avatar: null,
    },
  },
  {
    id: 'norwegian',
    label: 'æøå',
    input: {
      text: 'Ærlig talt, øvelse gjør mester — blåbærsyltetøy!',
      username: 'poet',
      avatar: avatarFallback,
    },
  },
  {
    id: 'long-word',
    label: 'A very long word',
    input: {
      text: 'supercalifragilisticexpialidocious'.repeat(5),
      username: 'poet',
      avatar: avatarFallback,
    },
  },
  {
    id: 'newlines',
    label: 'Multiple line breaks',
    input: {
      text: 'First line\n\nSecond line\nAnd a third.',
      username: 'poet',
      avatar: avatarFallback,
    },
  },
  {
    id: 'forest',
    label: 'Forest background',
    input: {
      text: 'Green is good.',
      username: 'poet',
      avatar: avatarFallback,
      color: 'forest',
    },
  },
  {
    id: 'plum',
    label: 'Plum background',
    input: {
      text: 'Plum is fun.',
      username: 'poet',
      avatar: avatarFallback,
      color: 'plum',
    },
  },
  {
    id: 'profile',
    label: 'Profile (bio)',
    input: {
      text: 'I write short things and sometimes long ones. Say hi!',
      username: 'poet',
      avatar: avatarFallback,
      color: 'teal',
    },
  },
  {
    id: 'blurt',
    label: 'BLURT post',
    input: {
      text: 'BLURT',
      username: 'poet',
      avatar: avatarFallback,
      style: 'blurt',
    },
  },
  {
    id: 'no-avatar',
    label: 'No avatar',
    input: {
      text: 'No avatar? No problem.',
      username: 'avatarless',
      avatar: null,
    },
  },
  {
    id: 'special',
    label: 'HTML and special characters',
    input: { text: '<script> & "quotes"', username: 'poet', avatar: null },
  },
]

export async function debugOgPng(id: string, debug = false): Promise<Buffer | undefined> {
  const example = debugExamples.find((item) => item.id === id)
  return example ? renderOgPng(example.input, debug) : undefined
}

// A card on a picture is a JPEG (.jpg), every other card a PNG.
export function ogImagePath(id: number, hash: string, picture = false): string {
  return `/og/${id}-${hash}.${picture ? 'jpg' : 'png'}`
}

export function ogProfileImagePath(username: string, hash: string): string {
  return `/og/u/${username}/${hash}.png`
}

// The text of a profile's card: the bio as plain text, cut to a blurt's length, so the
// card has the same limits as a blurt's. Empty when there is no bio.
export function profileCardText(bio: string): string {
  const normalized = bio
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const chars = [...normalized]
  return chars.length <= blurtMaxLength
    ? chars.join('')
    : `${chars
        .slice(0, blurtMaxLength - 1)
        .join('')
        .trimEnd()}…`
}

export function debugOgPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Open Graph images · blurt.trade</title><link rel="stylesheet" href="/static/og-debug.css"></head><body><h1>Open Graph image previews</h1><main>${debugExamples
    .map(
      ({ id, label }) =>
        `<figure><img src="/og/debug/${id}.png?debug=1" alt="${escapeHtml(
          label,
        )}"><figcaption>${escapeHtml(label)}</figcaption></figure>`,
    )
    .join('')}</main></body></html>`
}

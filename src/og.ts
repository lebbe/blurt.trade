import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { blurtMaxLength } from './limits.ts'
import type { Avatar } from './avatar.ts'
import { AvatarSvg } from './templates/avatar.ts'

export const OG_TEMPLATE_VERSION = 1
export const OG_AVATAR_VERSION = 1
export const OG_WIDTH = 1200
export const OG_HEIGHT = 630
export const OG_MIN_FONT_SIZE = 30
export const OG_MAX_FONT_SIZE = 140

export type OgInput = {
  text: string
  username: string
  avatar: Avatar | null
  style?: 'post' | 'blurt'
}

export type TextLayout = { fontSize: number; lines: string[]; width: number; height: number }

const fontDir = join(import.meta.dirname, '..', 'assets', 'fonts')
GlobalFonts.registerFromPath(join(fontDir, 'Lato-Black.ttf'), 'Lato Black')
GlobalFonts.registerFromPath(join(fontDir, 'NotoColorEmoji.ttf'), 'Noto Color Emoji')
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const measureContext = createCanvas(1, 1).getContext('2d')
const textBox = { x: 370, y: 102, width: 770, height: 450 }
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
        templateVersion,
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

export function measureOgText(text: string, fontSize: number): number {
  return measureText(text, fontSize)
}

export function fitOgText(
  text: string,
  { width = textBox.width, height = textBox.height } = {},
): TextLayout {
  const fits = (fontSize: number) => {
    const lines = wrapOgText(text, fontSize, width)
    return {
      fontSize,
      lines,
      width,
      height: lines.length * fontSize * lineHeightFactor,
    }
  }
  let low = OG_MIN_FONT_SIZE
  let high = OG_MAX_FONT_SIZE
  let best = fits(low)
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = fits(middle)
    if (candidate.height <= height) {
      best = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return best
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

async function canvasFor(input: OgInput, debug = false): Promise<Buffer> {
  const special = input.style === 'blurt'
  const font = fitOgText(input.text, {
    height: special && input.text !== 'BLURT' ? 390 : textBox.height,
  })
  const avatar = input.avatar ?? avatarFallback
  const faceSvg = renderToString(
    h(AvatarSvg, {
      avatar: { ...avatar, ...(special ? { eyeType: 'angry' as const } : {}) },
      size: 'large',
      openMouth: true,
    }),
  )
  const face = await loadImage(Buffer.from(faceSvg))
  const canvas = createCanvas(OG_WIDTH, OG_HEIGHT)
  const context = canvas.getContext('2d')
  const gradient = context.createLinearGradient(0, 0, OG_WIDTH, OG_HEIGHT)
  gradient.addColorStop(0, special ? '#f00020' : '#11152c')
  gradient.addColorStop(1, special ? '#a90017' : '#242b4a')
  context.fillStyle = gradient
  context.fillRect(0, 0, OG_WIDTH, OG_HEIGHT)
  if (special) {
    context.fillStyle = '#d4001c'
    context.fillRect(0, 0, OG_WIDTH, 136)
    context.font = '900 118px "Lato Black"'
    context.textAlign = 'center'
    context.fillStyle = '#ffffff'
    context.fillText('BLURT', OG_WIDTH / 2, 111, 800)
  } else {
    context.font = '900 25px "Lato Black"'
    context.textAlign = 'left'
    context.fillStyle = '#ffbd59'
    context.fillText(`@${input.username}`, textBox.x, 70, textBox.width)
  }
  context.drawImage(face, 38, 166, 300, 300)
  context.font = `900 ${font.fontSize}px "Lato Black", "Noto Color Emoji"`
  context.textAlign = 'left'
  context.fillStyle = '#f9f5ef'
  const firstBaseline = special ? 146 : textBox.y + font.fontSize * 0.85
  if (!(special && input.text === 'BLURT')) {
    font.lines.forEach((line, index) => {
      context.fillText(
        line,
        textBox.x,
        firstBaseline + index * font.fontSize * lineHeightFactor,
        textBox.width,
      )
    })
  }
  context.font = '900 20px "Lato Black"'
  context.textAlign = 'left'
  context.fillText(`@${input.username}`, 42, 592, 600)
  context.font = '900 18px "Lato Black"'
  context.textAlign = 'right'
  context.fillStyle = '#ffbd59'
  context.fillText('blurt.trade', 1155, 592)
  if (debug) {
    context.strokeStyle = '#00eaff'
    context.lineWidth = 2
    context.strokeRect(
      textBox.x,
      special ? 136 : textBox.y,
      textBox.width,
      special ? 390 : textBox.height,
    )
    context.font = '900 18px "Lato Black"'
    context.fillStyle = '#00eaff'
    context.fillText(`${font.fontSize}px`, 1155, 32)
  }
  return canvas.toBuffer('image/png')
}

export async function renderOgPng(input: OgInput, debug = false): Promise<Buffer> {
  return canvasFor(input, debug)
}

const cacheDir = process.env.OG_CACHE_DIR || join(import.meta.dirname, '..', 'og-cache')
const inFlight = new Map<string, Promise<Buffer>>()

export async function cachedOgPng(
  cacheKey: string,
  generate: () => Buffer | Promise<Buffer>,
): Promise<Buffer> {
  const path = join(cacheDir, `${cacheKey}.png`)
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
  { id: 'short', label: '3 characters', input: { text: 'Hey', username: 'poet', avatar: null } },
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
    input: { text: 'W'.repeat(blurtMaxLength), username: 'poet', avatar: avatarFallback },
  },
  {
    id: 'emoji',
    label: 'Emoji',
    input: { text: '🌈✨🗣️ This is blurted with feeling! 💥🎉', username: 'poet', avatar: null },
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
    id: 'blurt',
    label: 'BLURT post',
    input: { text: 'BLURT', username: 'poet', avatar: avatarFallback, style: 'blurt' },
  },
  {
    id: 'no-avatar',
    label: 'No avatar',
    input: { text: 'No avatar? No problem.', username: 'avatarless', avatar: null },
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

export function ogImagePath(id: number, hash: string): string {
  return `/og/${id}-${hash}.png`
}

export function debugOgPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Open Graph images · blurt.trade</title><link rel="stylesheet" href="/static/og-debug.css"></head><body><h1>Open Graph image previews</h1><main>${debugExamples
    .map(
      ({ id, label }) =>
        `<figure><img src="/og/debug/${id}.png?debug=1" alt="${escapeHtml(label)}"><figcaption>${escapeHtml(label)}</figcaption></figure>`,
    )
    .join('')}</main></body></html>`
}

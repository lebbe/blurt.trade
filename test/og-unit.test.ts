import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { blurtMaxLength } from '../src/limits.ts'
import {
  OG_AVATAR_VERSION,
  OG_HEIGHT,
  OG_MIN_FONT_SIZE,
  OG_WIDTH,
  cachedOgPng,
  debugExamples,
  fitOgText,
  measureOgText,
  ogHash,
  renderOgPng,
  wrapOgText,
} from '../src/og.ts'
import { renderBlurtPage } from '../src/templates/index.ts'
import { AvatarSvg } from '../src/templates/avatar.ts'
import type { Blurt } from '../src/routes/state.ts'

const avatar = {
  headWidth: 'regular' as const,
  skin: '#f1c27d',
  hairType: 'tuft' as const,
  hairColor: '#2c222b',
  eyeType: 'classic' as const,
  eyeColor: '#ffffff',
  pupilColor: '#000000',
  toothType: 'two' as const,
  toothColor: '#ffffff',
}

test('the text fit grows for short text and fits maximum-length text at the floor', () => {
  const short = fitOgText('Hey')
  const long = fitOgText('W'.repeat(blurtMaxLength))
  const emoji = fitOgText('😀'.repeat(blurtMaxLength))
  assert.ok(short.fontSize > long.fontSize)
  assert.ok(long.fontSize >= OG_MIN_FONT_SIZE)
  assert.ok(long.height <= 450)
  assert.ok(emoji.fontSize >= OG_MIN_FONT_SIZE)
  assert.ok(emoji.height <= 450)
  assert.ok(
    long.lines.every((line) => measureOgText(line, long.fontSize) <= long.width),
    'no wrapped line is wider than the text box',
  )
  assert.ok(wrapOgText('line one\n\nline two', short.fontSize).join(' ').includes('line two'))
})

test('the image hash changes with every image input and is otherwise stable', () => {
  const original = { text: 'hello', username: 'poet', avatar }
  const hash = ogHash(original)
  assert.equal(ogHash(original), hash)
  assert.notEqual(ogHash({ ...original, text: 'goodbye' }), hash)
  assert.notEqual(ogHash({ ...original, username: 'writer' }), hash)
  assert.notEqual(ogHash({ ...original, avatar: { ...avatar, skin: '#000000' } }), hash)
  assert.notEqual(ogHash(original, 2), hash)
  assert.notEqual(ogHash(original, undefined, OG_AVATAR_VERSION + 1), hash)
})

test('concurrent cache misses generate an image only once', async () => {
  const key = `og-cache-test-${randomUUID()}`
  let generated = 0
  const image = Buffer.from('same image')
  const responses = await Promise.all(
    Array.from({ length: 8 }, () =>
      cachedOgPng(key, async () => {
        generated += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
        return image
      }),
    ),
  )
  assert.equal(generated, 1)
  assert.ok(responses.every((response) => response.equals(image)))
})

test('debug examples cover all requested image inputs and fit without clipping', () => {
  assert.equal(debugExamples.length, 10)
  assert.equal(debugExamples.find(({ id }) => id === 'maximum')?.input.text.length, blurtMaxLength)
  assert.equal(debugExamples.find(({ id }) => id === 'blurt')?.input.style, 'blurt')
  for (const { input } of debugExamples) {
    assert.ok(fitOgText(input.text).fontSize >= OG_MIN_FONT_SIZE)
  }
})

test('every example renders as a compact 1200-by-630 PNG', async () => {
  for (const { input } of debugExamples) {
    const image = await renderOgPng(input)
    assert.equal(image.readUInt32BE(16), OG_WIDTH)
    assert.equal(image.readUInt32BE(20), OG_HEIGHT)
    assert.ok(image.length < 1_000_000)
  }
})

test('open-mouth avatar is the static peak flap pose, not an extra mouth drawing', () => {
  const svg = renderToString(h(AvatarSvg, { avatar, openMouth: true }))
  assert.equal(
    (svg.match(/class="avatar-top" transform="translate\(0 -4\) rotate\(21 86 58\)"/g) ?? [])
      .length,
    2,
  )
  assert.equal((svg.match(/class="avatar-jaw" transform="translate\(0 3\)"/g) ?? []).length, 2)
  assert.doesNotMatch(svg, /<ellipse cx="50" cy="68"/)

  const talking = renderToString(h(AvatarSvg, { avatar }))
  assert.doesNotMatch(talking, /class="avatar-top" transform=/)
  assert.doesNotMatch(talking, /class="avatar-jaw" transform=/)
})

test('blurt metadata preserves and escapes full text and hides deleted content', () => {
  const text = `A full description & <script> "with quotes" ${'x'.repeat(180)}`
  const blurt: Blurt = {
    id: 19,
    username: 'poet',
    text,
    createdAt: new Date('2026-10-17T07:50:00.000Z'),
    parentId: null,
    parentUsername: null,
    replyCount: 0,
    avatar: null,
    deleted: false,
    likeCount: 0,
    viewerLikes: false,
    reblurtCount: 0,
    viewerReblurted: false,
    reblurtedBy: null,
    quoted: null,
  }
  const render = (value: Blurt) =>
    renderBlurtPage({
      viewer: null,
      blurt: value,
      parent: null,
      reported: false,
      replies: [],
      next: null,
      related: [],
    })
  const page = render(blurt)
  assert.match(page, /<title>poet blurted · blurt\.trade<\/title>/)
  assert.match(
    page,
    /description" content="A full description &amp; &lt;script> &quot;with quotes&quot;/,
  )
  assert.ok(page.includes('x'.repeat(180)))
  assert.match(page, /property="og:image:type" content="image\/png"/)
  assert.match(page, /property="og:image:width" content="1200"/)
  assert.match(page, /property="og:image:height" content="630"/)
  assert.match(page, /name="twitter:card" content="summary_large_image"/)

  const deleted = render({ ...blurt, username: null, text: null, avatar: null, deleted: true })
  assert.match(deleted, /og:image" content="https:\/\/blurt\.trade\/static\/og-image\.png"/)
  assert.doesNotMatch(deleted, /A full description|x{20}/)
})

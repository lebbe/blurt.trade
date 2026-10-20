import test from 'node:test'
import sharp from 'sharp'
import assert from 'node:assert/strict'
import { samplePng } from './helpers.ts'
import { encodeShapes, pictureFromUpload, pictureSvg } from '../src/picture.ts'

test('draws an uploaded image as a small SVG of rects and paths', async () => {
  const shapes = await pictureFromUpload(samplePng())
  assert.ok(shapes)
  assert.equal(shapes.width, 640)
  assert.equal(shapes.height, 320)
  const bytes = encodeShapes(shapes)
  assert.ok(bytes.length >= 6 && bytes.length < 3000)
  const svg = pictureSvg(bytes)
  assert.ok(svg.startsWith('<svg'))
  assert.match(svg, /<path /)
  assert.doesNotMatch(svg, /<(script|text|image)/)
})

test('pictureSvg throws on truncated or random bytes', async () => {
  const shapes = await pictureFromUpload(samplePng(100, 100))
  const bytes = encodeShapes(shapes!)
  assert.throws(() => pictureSvg(bytes.subarray(0, bytes.length - 1)))
  assert.throws(() => pictureSvg(bytes.subarray(0, 3)))
  assert.throws(() => pictureSvg(Buffer.from('hello, not a picture')))
  assert.throws(() => pictureSvg(Buffer.alloc(0)))
  assert.throws(() => pictureSvg(Buffer.from([1, 0, 1, 0, 1, 99])))
})

test('pictureFromUpload gives undefined for something that is no image', async () => {
  assert.equal(await pictureFromUpload(Buffer.from('hei')), undefined)
})

test('pictureFromUpload refuses SVG and images with too many pixels', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
  assert.equal(await pictureFromUpload(svg), undefined)
  // A one-colour PNG of 20 000 × 20 000 (400 MP) is a few hundred KB.
  const huge = await sharp({
    create: { width: 20000, height: 20000, channels: 3, background: '#ffffff' },
    limitInputPixels: false,
  })
    .png({ compressionLevel: 9 })
    .toBuffer()
  assert.ok(huge.length < 15 * 1024 * 1024)
  assert.equal(await pictureFromUpload(huge), undefined)
})

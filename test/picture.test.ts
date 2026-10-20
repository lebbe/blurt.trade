import test from 'node:test'
import { crc32 } from 'node:zlib'
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
  // Only a header claiming 20 000 × 20 000 (400 MP): the pixel cap is checked before decoding.
  const huge = headerOnlyPng(20000, 20000)
  const { width, height } = await sharp(huge, { limitInputPixels: false }).metadata()
  assert.deepEqual([width, height], [20000, 20000])
  assert.equal(await pictureFromUpload(huge), undefined)
})

// A PNG with a valid IHDR and IEND and an empty IDAT, so no image data. (libspng reports
// a PNG without any IDAT as corrupt, even for its size.)
function headerOnlyPng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 2, 0, 0, 0], 8) // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', Buffer.alloc(0)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

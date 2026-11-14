import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { busyPicture, samplePng } from './helpers.ts'
import { decodeUpload, encodeShapes, pictureFromUpload, pictureSvg } from '../src/picture.ts'
import { vectorize } from '../src/shared/picture/draw.ts'
import {
  decodeShapes,
  drawnSize,
  encodeShapes as encodeShared,
} from '../src/shared/picture/shapes.ts'
import { photoPartSvg } from '../src/shared/picture/svg.ts'

// The drawing code moved to src/shared/picture/ so the browser can run it too. What the
// server stores and serves must not change: these are the drawings the code made before
// the move (sha256 of the stored bytes and of the SVG, first 16 hex).
const hash = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex').slice(0, 16)

test('the server draws exactly what it drew before the drawing code was shared', async () => {
  const cases = [
    {
      file: samplePng(),
      square: false,
      bytes: 43,
      shapes: 'a9546fb2dcbfbb73',
      svg: '8eeabea8df7c5bd7',
    },
    {
      file: busyPicture(1200, 900),
      square: false,
      bytes: 1740,
      shapes: 'fac6ab008271f2e1',
      svg: '95503c60534d84fb',
    },
    {
      file: busyPicture(900, 1200),
      square: true,
      bytes: 1293,
      shapes: 'd0c7dd272782072c',
      svg: '890e358d32b4f9ba',
    },
  ]
  for (const { file, square, bytes, shapes, svg } of cases) {
    const stored = encodeShapes((await pictureFromUpload(file, { square }))!)
    assert.ok(Buffer.isBuffer(stored), 'a Buffer, for the database')
    assert.equal(stored.length, bytes)
    assert.equal(hash(stored), shapes)
    assert.equal(hash(pictureSvg(stored)), svg)
  }
})

test('the shared code is what the server runs: decode, vectorize, encode', async () => {
  const image = await decodeUpload(busyPicture(), {})
  assert.ok(image)
  assert.deepEqual([image.width, image.height], [640, 480])
  const shared = encodeShared(vectorize(image))
  assert.ok(shared instanceof Uint8Array)
  assert.deepEqual(Buffer.from(shared), encodeShapes((await pictureFromUpload(busyPicture()))!))
  // The format round-trips.
  assert.deepEqual(encodeShared(decodeShapes(shared)), shared)
})

test('drawnSize scales the longest side to 640, as sharp does', () => {
  assert.deepEqual(drawnSize(800, 400), { width: 640, height: 320 })
  assert.deepEqual(drawnSize(100, 100), { width: 640, height: 640 })
  assert.deepEqual(drawnSize(3000, 2000), { width: 640, height: 427 })
  assert.deepEqual(drawnSize(5000, 1), { width: 640, height: 1 })
})

test('photoPartSvg gives the profile picture halves', async () => {
  const shapes = encodeShapes((await pictureFromUpload(samplePng(), { square: true }))!)
  assert.match(photoPartSvg(shapes, 65, 'top'), /viewBox="0 0 640 424" width="640" height="424"/)
  assert.match(photoPartSvg(shapes, 65, 'jaw'), /viewBox="0 416 640 224" width="640" height="224"/)
  assert.match(photoPartSvg(shapes, 50, 'edit'), /<path d="M0 320H640"/)
})

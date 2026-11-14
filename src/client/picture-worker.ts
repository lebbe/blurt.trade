import { vectorize } from '../shared/picture/draw.ts'
import { drawnSize, encodeShapes, pictureSize } from '../shared/picture/shapes.ts'

// A Web Worker (started by ./picture-preview.ts) that draws a picture in the browser, with
// the server's own drawing code (src/shared/picture/), so the page can show the drawing
// before anything is uploaded, without freezing while it is made (it takes a moment).
//
// The server decodes and scales an upload with sharp (src/picture.ts); here
// createImageBitmap() and an OffscreenCanvas do that part. Their scaling is not sharp's,
// so the preview is close to what the server will draw but not always identical. From the
// same RGBA pixels the two give identical shapes (test/e2e/picture.test.ts).
//
// It also hands back the scaled pixels as a PNG, which the page uploads instead of the
// original when that is smaller: the server then decodes exactly the pixels drawn here, so
// its drawing matches the preview, and the upload is small.
//
// Only relative imports, and none that reach Preact: the page's import map does not apply
// inside a worker in every browser. The worker's own Content-Security-Policy is the one its
// script was served with (src/client-modules.ts: script-src 'self', nothing else).

// A square in the image's own pixels (after its EXIF orientation), for a profile picture.
export type Crop = { x: number; y: number; size: number }

export type PictureRequest =
  | { id: number; kind: 'draw'; file: Blob; crop?: Crop; upload?: boolean }
  | { id: number; kind: 'rgba'; width: number; height: number; data: Uint8ClampedArray }

export type PictureResult = {
  id: number
  // The image's size, as decoded (for the crop frame).
  source: { width: number; height: number }
  width: number
  height: number
  shapes: Uint8Array
  // The scaled pixels as PNG, when asked for (`upload`).
  upload?: Blob
  // How long each step took, in milliseconds.
  timings: { decode: number; scale: number; draw: number; encode: number }
}

export type PictureFailure = { id: number; error: string }

type WorkerScope = {
  onmessage: ((event: MessageEvent<PictureRequest>) => void) | null
  postMessage: (message: PictureResult | PictureFailure, transfer?: Transferable[]) => void
}
const scope = self as unknown as WorkerScope

// The last file decoded, kept while the crop frame moves over it.
let decoded: { file: Blob; bitmap: ImageBitmap } | undefined

async function bitmapOf(file: Blob): Promise<ImageBitmap> {
  if (decoded?.file !== file) {
    decoded?.bitmap.close()
    decoded = undefined
    // EXIF orientation is applied ('from-image', the default), as sharp's rotate() does.
    decoded = { file, bitmap: await createImageBitmap(file, { imageOrientation: 'from-image' }) }
  }
  return decoded.bitmap
}

async function draw(request: Extract<PictureRequest, { kind: 'draw' }>): Promise<PictureResult> {
  const started = performance.now()
  const bitmap = await bitmapOf(request.file)
  const decodedAt = performance.now()
  // The part of the image drawn: the crop, or all of it.
  const crop = request.crop
  const from = crop
    ? { x: crop.x, y: crop.y, width: crop.size, height: crop.size }
    : { x: 0, y: 0, width: bitmap.width, height: bitmap.height }
  const { width, height } = crop
    ? { width: pictureSize, height: pictureSize }
    : drawnSize(bitmap.width, bitmap.height)
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    throw new Error('no 2d canvas')
  }
  // On white, as the server flattens transparent pictures.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, from.x, from.y, from.width, from.height, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height)
  const scaledAt = performance.now()
  const shapes = encodeShapes(vectorize({ width, height, data: pixels.data }))
  const drawnAt = performance.now()
  const upload = request.upload ? await canvas.convertToBlob({ type: 'image/png' }) : undefined
  return {
    id: request.id,
    source: { width: bitmap.width, height: bitmap.height },
    width,
    height,
    shapes,
    upload,
    timings: {
      decode: decodedAt - started,
      scale: scaledAt - decodedAt,
      draw: drawnAt - scaledAt,
      encode: performance.now() - drawnAt,
    },
  }
}

// Exactly the given pixels, drawn: for comparing with the server's drawing in tests.
function drawPixels(request: Extract<PictureRequest, { kind: 'rgba' }>): PictureResult {
  const started = performance.now()
  const { width, height, data } = request
  const shapes = encodeShapes(vectorize({ width, height, data }))
  return {
    id: request.id,
    source: { width, height },
    width,
    height,
    shapes,
    timings: { decode: 0, scale: 0, draw: performance.now() - started, encode: 0 },
  }
}

scope.onmessage = async ({ data: request }) => {
  try {
    const result = request.kind === 'rgba' ? drawPixels(request) : await draw(request)
    scope.postMessage(result, [result.shapes.buffer as ArrayBuffer])
  } catch (error) {
    scope.postMessage({ id: request.id, error: String(error) })
  }
}

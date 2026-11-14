import sharp from 'sharp'
import { vectorize, type RgbaImage } from './shared/picture/draw.ts'
import {
  decodeShapes,
  encodeShapes as encode,
  pictureColors,
  pictureSize,
  type Shapes,
} from './shared/picture/shapes.ts'
import { pictureSvg } from './shared/picture/svg.ts'

// Blurt pictures: an uploaded photo becomes a rough, cartoonish drawing, and only the
// drawing is kept. The upload is never stored. The steps: scale down to 640 px on the
// longest side, stretch the contrast, paint every pixel with the nearest of 16 fixed
// colours, smooth and merge specks into flat areas, then trace each area's outline. The
// outlines are stored in a small binary format ("shapes"); pictureSvg() draws them.
//
// Only the first step, decoding and scaling, is the server's own (sharp, here). The rest
// is pure arithmetic on the RGBA pixels and lives in src/shared/picture/, so the browser
// can run it too and show the drawing before anything is uploaded
// (src/client/picture-worker.ts). The server still draws every upload itself: what it
// stores is the picture, the browser's is only a preview.

export { decodeShapes, pictureColors, pictureSvg, vectorize, type Shapes }

// Refuses images with more pixels than this, checked from the header before decoding.
const maxInputPixels = 300_000_000
const inputFormats = new Set(['jpeg', 'png', 'webp', 'gif'])

// Decodes an uploaded image (JPEG, PNG, WebP, GIF) into the RGBA pixels it is drawn from:
// turned by its EXIF orientation, scaled to 640 px on the longest side, on white.
// Undefined when the bytes are not such an image, or it has too many pixels. libvips
// shrinks JPEG and WebP while decoding, so memory stays small however large the image is.
// `square` (profile pictures) crops the middle square out of it first, at 640 × 640.
export async function decodeUpload(
  file: Buffer,
  { square = false }: { square?: boolean } = {},
): Promise<RgbaImage | undefined> {
  try {
    const options = { limitInputPixels: maxInputPixels, failOn: 'error' } as const
    const { format } = await sharp(file, options).metadata()
    if (!format || !inputFormats.has(format)) return undefined
    const { data, info } = await sharp(file, options)
      .rotate() // applies the EXIF orientation
      .resize(pictureSize, pictureSize, { fit: square ? 'cover' : 'inside' })
      .flatten({ background: '#ffffff' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (!info.width || !info.height) return undefined
    return {
      width: info.width,
      height: info.height,
      data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    }
  } catch {
    return undefined
  }
}

// An upload drawn (decodeUpload, then vectorize). Undefined when it is no picture.
export async function pictureFromUpload(
  file: Buffer,
  options: { square?: boolean } = {},
): Promise<Shapes | undefined> {
  const image = await decodeUpload(file, options)
  try {
    return image && vectorize(image)
  } catch {
    return undefined
  }
}

// The stored format (src/shared/picture/shapes.ts), as a Buffer for the database.
export function encodeShapes(shapes: Shapes): Buffer {
  const bytes = encode(shapes)
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length)
}

import { createCanvas, loadImage } from '@napi-rs/canvas'

// A blurt's picture is never the uploaded image, only a rough drawing of it: flat colors
// from a fixed palette on a coarse grid. pictureFromUpload reads an upload into Shapes,
// encodeShapes gives the bytes that are stored, and pictureSvg turns stored bytes into SVG.
//
// Stored format (big endian): version (1 byte, 1), width and height of the drawing in
// pixels (2 bytes each), the background color (1 byte, a palette index), then any number
// of rectangles of 5 bytes: color, x, y, width and height, in grid cells. The cell size
// follows from width and height (cellSize), so it isn't stored.

export const pictureMaxSide = 640
// The drawing is at most this many cells on its longest side.
const gridCells = 48
// Refuses to decode images with more pixels than this (decompression bombs).
const maxSourcePixels = 100_000_000
const version = 1
const headerBytes = 6
const rectBytes = 5

const palette = [
  '#111111',
  '#555555',
  '#999999',
  '#cccccc',
  '#f5f5f5',
  '#d4001c',
  '#f08a24',
  '#f5d90a',
  '#7cc242',
  '#1e7a3c',
  '#35c4c4',
  '#2f6fdb',
  '#1b2a6b',
  '#7b3fb5',
  '#f08ab4',
  '#7a4a24',
]

const paletteRgb = palette.map((color) => [
  Number.parseInt(color.slice(1, 3), 16),
  Number.parseInt(color.slice(3, 5), 16),
  Number.parseInt(color.slice(5, 7), 16),
])

export type Rect = { color: number; x: number; y: number; w: number; h: number }

export type Shapes = {
  width: number
  height: number
  background: number
  rects: Rect[]
}

function cellSize(width: number, height: number): number {
  return Math.max(1, Math.ceil(Math.max(width, height) / gridCells))
}

function nearestColor(r: number, g: number, b: number): number {
  let best = 0
  let bestDistance = Infinity
  for (const [index, [pr, pg, pb]] of paletteRgb.entries()) {
    const distance = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  }
  return best
}

// Decodes a JPEG, PNG, WebP or GIF, scales it to at most 640 px on the longest side and
// draws it. Undefined if the bytes aren't an image we can read.
export async function pictureFromUpload(buffer: Buffer): Promise<Shapes | undefined> {
  let image
  try {
    image = await loadImage(buffer)
  } catch {
    return undefined
  }
  const { width: sourceWidth, height: sourceHeight } = image
  if (sourceWidth < 1 || sourceHeight < 1 || sourceWidth * sourceHeight > maxSourcePixels) {
    return undefined
  }
  const scale = Math.min(1, pictureMaxSide / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))

  // Scaled once at full size, then down to one pixel per cell, so each cell is an average.
  const scaled = createCanvas(width, height)
  const scaledContext = scaled.getContext('2d')
  scaledContext.fillStyle = '#ffffff'
  scaledContext.fillRect(0, 0, width, height)
  scaledContext.drawImage(image, 0, 0, width, height)

  const cell = cellSize(width, height)
  const columns = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  const grid = createCanvas(columns, rows)
  const gridContext = grid.getContext('2d')
  gridContext.imageSmoothingQuality = 'high'
  gridContext.drawImage(scaled, 0, 0, columns, rows)
  const { data } = gridContext.getImageData(0, 0, columns, rows)

  const colors: number[] = []
  const counts = Array.from({ length: palette.length }, () => 0)
  for (let index = 0; index < columns * rows; index++) {
    const color = nearestColor(data[index * 4], data[index * 4 + 1], data[index * 4 + 2])
    colors.push(color)
    counts[color]++
  }
  const background = counts.indexOf(Math.max(...counts))

  // Runs of one color along each row, then runs that repeat in the next row become one
  // taller rectangle.
  const rects: Rect[] = []
  let open = new Map<string, Rect>()
  for (let y = 0; y < rows; y++) {
    const next = new Map<string, Rect>()
    let x = 0
    while (x < columns) {
      const color = colors[y * columns + x]
      let end = x + 1
      while (end < columns && colors[y * columns + end] === color) {
        end++
      }
      if (color !== background) {
        const key = `${color},${x},${end - x}`
        const above = open.get(key)
        if (above) {
          above.h++
          next.set(key, above)
        } else {
          const rect = { color, x, y, w: end - x, h: 1 }
          rects.push(rect)
          next.set(key, rect)
        }
      }
      x = end
    }
    open = next
  }
  return { width, height, background, rects }
}

// The bytes to store. Callers check the length against their limit.
export function encodeShapes(shapes: Shapes): Buffer {
  const bytes = Buffer.alloc(headerBytes + shapes.rects.length * rectBytes)
  bytes.writeUInt8(version, 0)
  bytes.writeUInt16BE(shapes.width, 1)
  bytes.writeUInt16BE(shapes.height, 3)
  bytes.writeUInt8(shapes.background, 5)
  for (const [index, rect] of shapes.rects.entries()) {
    const at = headerBytes + index * rectBytes
    bytes.writeUInt8(rect.color, at)
    bytes.writeUInt8(rect.x, at + 1)
    bytes.writeUInt8(rect.y, at + 2)
    bytes.writeUInt8(rect.w, at + 3)
    bytes.writeUInt8(rect.h, at + 4)
  }
  return bytes
}

// Decodes and checks stored bytes. Throws on anything that encodeShapes couldn't have made.
function decodeShapes(bytes: Uint8Array): Shapes {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (buffer.length < headerBytes || (buffer.length - headerBytes) % rectBytes !== 0) {
    throw new Error('Invalid picture: wrong length')
  }
  if (buffer.readUInt8(0) !== version) {
    throw new Error('Invalid picture: unknown version')
  }
  const width = buffer.readUInt16BE(1)
  const height = buffer.readUInt16BE(3)
  const background = buffer.readUInt8(5)
  if (width < 1 || width > pictureMaxSide || height < 1 || height > pictureMaxSide) {
    throw new Error('Invalid picture: bad size')
  }
  if (background >= palette.length) {
    throw new Error('Invalid picture: bad color')
  }
  const cell = cellSize(width, height)
  const columns = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  const rects: Rect[] = []
  for (let at = headerBytes; at < buffer.length; at += rectBytes) {
    const rect = {
      color: buffer.readUInt8(at),
      x: buffer.readUInt8(at + 1),
      y: buffer.readUInt8(at + 2),
      w: buffer.readUInt8(at + 3),
      h: buffer.readUInt8(at + 4),
    }
    if (
      rect.color >= palette.length ||
      rect.w < 1 ||
      rect.h < 1 ||
      rect.x + rect.w > columns ||
      rect.y + rect.h > rows
    ) {
      throw new Error('Invalid picture: bad rectangle')
    }
    rects.push(rect)
  }
  return { width, height, background, rects }
}

// The SVG for stored bytes: a background <rect> and one <path> per color, all numbers and
// palette colors. Nothing from the bytes goes into the markup as text.
export function pictureSvg(bytes: Uint8Array): string {
  const { width, height, background, rects } = decodeShapes(bytes)
  const cell = cellSize(width, height)
  const paths = new Map<number, string[]>()
  for (const { color, x, y, w, h } of rects) {
    const parts = paths.get(color) ?? []
    parts.push(`M${x * cell} ${y * cell}h${w * cell}v${h * cell}h${-w * cell}z`)
    paths.set(color, parts)
  }
  const drawn = [...paths.entries()]
    .map(([color, parts]) => `<path fill="${palette[color]}" d="${parts.join('')}"/>`)
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">` +
    `<rect width="${width}" height="${height}" fill="${palette[background]}"/>${drawn}</svg>`
  )
}

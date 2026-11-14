// A drawn picture ("shapes"): the flat areas a photo was turned into (./draw.ts), each an
// outline in one of 16 fixed colours, and the small binary format they are stored in.
// Shared by the server (src/picture.ts, which decodes uploads with sharp) and the browser
// (src/client/picture-worker.ts, which previews the drawing before anything is uploaded),
// so both draw and read pictures with exactly the same code. No imports: this also runs in
// a Web Worker, where the page's import map does not apply.

// The longest side of a drawing, in pixels (a profile picture is this square).
export const pictureSize = 640

// The only colours a picture can have. No natural skin tones, on purpose.
export const pictureColors = [
  '#16141f',
  '#4a4858',
  '#8c8a99',
  '#f7f4ea',
  '#e8323f',
  '#ff8a3d',
  '#ffd23f',
  '#f7a8c4',
  '#7a3b2e',
  '#c98a4b',
  '#3fae49',
  '#1f6b3a',
  '#3fb8e8',
  '#2a4fb5',
  '#1d2a5c',
  '#8e44c9',
]

export type Point = [number, number]
export type Area = { color: number; points: Point[] }
export type Shapes = { width: number; height: number; background: number; areas: Area[] }

// The stored format, version 1. Varints are LEB128; deltas are zigzag varints.
//   u8 version | varint width | varint height | u8 background | varint area count
//   per area: u8 colour | varint point count | varint x | varint y | dx dy …
export function encodeShapes(shapes: Shapes): Uint8Array {
  const out: number[] = []
  const unsigned = (n: number) => {
    for (; n > 127; n >>>= 7) out.push((n & 127) | 128)
    out.push(n)
  }
  const signed = (n: number) => unsigned(n >= 0 ? n * 2 : -n * 2 - 1)
  out.push(1)
  unsigned(shapes.width)
  unsigned(shapes.height)
  out.push(shapes.background)
  unsigned(shapes.areas.length)
  for (const { color, points } of shapes.areas) {
    out.push(color)
    unsigned(points.length)
    unsigned(points[0][0])
    unsigned(points[0][1])
    for (let i = 1; i < points.length; i++) {
      signed(points[i][0] - points[i - 1][0])
      signed(points[i][1] - points[i - 1][1])
    }
  }
  return Uint8Array.from(out)
}

// Throws on anything that is not a well-formed version-1 picture.
export function decodeShapes(bytes: Uint8Array): Shapes {
  let i = 0
  const byte = () => {
    if (i >= bytes.length) throw new Error('picture: truncated')
    return bytes[i++]
  }
  const unsigned = () => {
    let n = 0
    for (let shift = 0; shift < 28; shift += 7) {
      const b = byte()
      n += (b & 127) * 2 ** shift
      if (!(b & 128)) return n
    }
    throw new Error('picture: bad number')
  }
  const signed = () => {
    const z = unsigned()
    return z % 2 ? -(z + 1) / 2 : z / 2
  }
  const check = (ok: boolean) => {
    if (!ok) throw new Error('picture: invalid')
  }
  check(byte() === 1)
  const width = unsigned()
  const height = unsigned()
  const background = byte()
  const count = unsigned()
  check(
    width >= 1 && width <= pictureSize && height >= 1 && height <= pictureSize && background < 16,
  )
  const areas: Area[] = []
  for (let k = 0; k < count; k++) {
    const color = byte()
    const length = unsigned()
    check(color < 16 && length >= 3)
    let [x, y] = [unsigned(), unsigned()]
    const points: Point[] = [[x, y]]
    for (let j = 1; j < length; j++) {
      x += signed()
      y += signed()
      check(x >= 0 && y >= 0 && x <= width && y <= height)
      points.push([x, y])
    }
    areas.push({ color, points })
  }
  check(i === bytes.length)
  return { width, height, background, areas }
}

// The size an image of width × height is drawn at: its longest side scaled to
// pictureSize, up or down, as sharp's resize(…, { fit: 'inside' }) does on the server.
export function drawnSize(width: number, height: number): { width: number; height: number } {
  const scale = pictureSize / Math.max(width, height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

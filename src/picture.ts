import sharp from 'sharp'

// Blurt pictures: an uploaded photo becomes a rough, cartoonish drawing, and only the
// drawing is kept. The upload is never stored. The steps: scale down to 640 px on the
// longest side, stretch the contrast, paint every pixel with the nearest of 16 fixed
// colours, smooth and merge specks into flat areas, then trace each area's outline. The
// outlines are stored in a small binary format ("shapes"); pictureSvg() draws them.

const size = 640 // longest side, in pixels
const smoothRadius = 4 // majority filter radius
const minAreaShare = 0.001 // areas under 0.1 % of the picture merge into a neighbour
const simplify = 2.8 // how far an outline may stray from the pixels, in pixels
const lightnessWeight = 3 // lightness counts 3× hue when picking a colour
const saturation = 1.3 // colour is strengthened 1.3× before picking, so pictures stay vivid

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

type Image = { width: number; height: number; data: Uint8ClampedArray }
type Point = [number, number]
export type Shapes = { width: number; height: number; background: number; areas: Area[] }
type Area = { color: number; points: Point[] }

function lab(r: number, g: number, b: number): [number, number, number] {
  const linear = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const [R, G, B] = [linear(r), linear(g), linear(b)]
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047)
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722)
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}
const paletteLab = pictureColors.map((hex) =>
  lab(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)),
)

// Stretches brightness so the darkest and lightest 1 % reach black and white.
function autoLevels({ width, height, data }: Image): void {
  const histogram = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 4) {
    histogram[(data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8]++
  }
  const cut = width * height * 0.01
  let low = 0
  let high = 255
  let below = histogram[0]
  let above = histogram[255]
  while (low < 255 && below <= cut) below += histogram[++low]
  while (high > 0 && above <= cut) above += histogram[--high]
  if (high - low < 16) {
    return
  }
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      data[i + c] = ((data[i + c] - low) * 255) / (high - low)
    }
  }
}

// The nearest palette colour of each pixel. Each 6-bit-per-channel colour is worked out once.
function quantize({ width, height, data }: Image): Uint8Array {
  const colors = new Uint8Array(width * height)
  const cache = new Int8Array(1 << 18).fill(-1)
  for (let i = 0; i < colors.length; i++) {
    const [r, g, b] = [data[i * 4] >> 2, data[i * 4 + 1] >> 2, data[i * 4 + 2] >> 2]
    const key = (r << 12) | (g << 6) | b
    if (cache[key] < 0) {
      const [L, A, B] = lab(r * 4 + 2, g * 4 + 2, b * 4 + 2)
      let best = Infinity
      paletteLab.forEach(([pL, pA, pB], k) => {
        const distance =
          lightnessWeight * (L - pL) ** 2 + (A * saturation - pA) ** 2 + (B * saturation - pB) ** 2
        if (distance < best) {
          best = distance
          cache[key] = k
        }
      })
    }
    colors[i] = cache[key]
  }
  return colors
}

// Each pixel takes the colour most of its neighbours within `radius` have.
function majority(colors: Uint8Array, width: number, height: number, radius: number) {
  const out = new Uint8Array(colors.length)
  const count = new Uint16Array(16)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      count.fill(0)
      for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy++) {
        for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx++) {
          count[colors[yy * width + xx]]++
        }
      }
      let best = colors[y * width + x]
      for (let k = 0; k < 16; k++) if (count[k] > count[best]) best = k
      out[y * width + x] = best
    }
  }
  return out
}

// Labels 4-connected areas of one colour.
function label(colors: Uint8Array, width: number) {
  const labels = new Int32Array(colors.length).fill(-1)
  const sizes: number[] = []
  const stack = new Int32Array(colors.length)
  for (let start = 0; start < colors.length; start++) {
    if (labels[start] !== -1) continue
    const n = sizes.length
    let top = 0
    let areaSize = 0
    stack[top++] = start
    labels[start] = n
    while (top) {
      const p = stack[--top]
      areaSize++
      const x = p % width
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (q >= 0 && q < colors.length && labels[q] === -1 && colors[q] === colors[start]) {
          labels[q] = n
          stack[top++] = q
        }
      }
    }
    sizes.push(areaSize)
  }
  return { labels, sizes }
}

// Areas smaller than minPixels take the colour they border most.
function mergeSpecks(colors: Uint8Array, width: number, minPixels: number): void {
  for (let round = 0; round < 5; round++) {
    const { labels, sizes } = label(colors, width)
    const votes = new Map<number, Uint32Array>()
    for (let p = 0; p < colors.length; p++) {
      if (sizes[labels[p]] >= minPixels) continue
      const x = p % width
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (q < 0 || q >= colors.length || labels[q] === labels[p]) continue
        const vote = votes.get(labels[p]) ?? new Uint32Array(16)
        vote[colors[q]] += sizes[labels[q]] >= minPixels ? 4 : 1
        votes.set(labels[p], vote)
      }
    }
    if (votes.size === 0) return
    const target = new Map<number, number>()
    for (const [area, vote] of votes) target.set(area, vote.indexOf(Math.max(...vote)))
    for (let p = 0; p < colors.length; p++) colors[p] = target.get(labels[p]) ?? colors[p]
  }
}

// Walks the outline of a filled mask along pixel edges, inside on the right, and returns
// its corners.
function trace(mask: Uint8Array, width: number, height: number): Point[] {
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1
  const start = mask.indexOf(1)
  const [sx, sy] = [start % width, Math.floor(start / width)]
  const dx = [1, 0, -1, 0]
  const dy = [0, 1, 0, -1]
  let [x, y, d] = [sx, sy, 0]
  const points: Point[] = [[x, y]]
  for (let steps = 4 * (width + 1) * (height + 1); steps > 0; steps--) {
    x += dx[d]
    y += dy[d]
    const right = [inside(x, y), inside(x - 1, y), inside(x - 1, y - 1), inside(x, y - 1)][d]
    const left = [inside(x, y - 1), inside(x, y), inside(x - 1, y), inside(x - 1, y - 1)][d]
    const next = !right ? (d + 1) % 4 : left ? (d + 3) % 4 : d
    if (x === sx && y === sy && next === 0) break
    if (next !== d) points.push([x, y])
    d = next
  }
  return points
}

// Douglas-Peucker, on an open line and then on a closed outline.
function simplifyLine(points: Point[], tolerance: number): Point[] {
  const [[ax, ay], [bx, by]] = [points[0], points[points.length - 1]]
  const length = Math.hypot(bx - ax, by - ay) || 1e-9
  let farthest = 0
  let distance = -1
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i]
    const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length
    if (d > distance) [distance, farthest] = [d, i]
  }
  if (distance <= tolerance) return [points[0], points[points.length - 1]]
  const head = simplifyLine(points.slice(0, farthest + 1), tolerance)
  return head.slice(0, -1).concat(simplifyLine(points.slice(farthest), tolerance))
}
function simplifyOutline(points: Point[], tolerance: number): Point[] {
  if (points.length < 4) return points
  const [x0, y0] = points[0]
  let far = 1
  points.forEach(([x, y], i) => {
    if (Math.hypot(x - x0, y - y0) > Math.hypot(points[far][0] - x0, points[far][1] - y0)) far = i
  })
  const a = simplifyLine(points.slice(0, far + 1), tolerance)
  const b = simplifyLine(points.slice(far).concat([points[0]]), tolerance)
  return a.slice(0, -1).concat(b.slice(0, -1))
}

export function vectorize(image: Image): Shapes {
  const { width, height } = image
  autoLevels(image)
  const colors = majority(quantize(image), width, height, smoothRadius)
  mergeSpecks(colors, width, Math.max(1, Math.round(minAreaShare * width * height)))
  const { labels, sizes } = label(colors, width)

  const count = new Uint32Array(16)
  colors.forEach((color) => count[color]++)
  const boxes = sizes.map(() => ({ x0: width, y0: height, x1: -1, y1: -1, color: 0 }))
  labels.forEach((n, p) => {
    const box = boxes[n]
    const [x, y] = [p % width, Math.floor(p / width)]
    box.x0 = Math.min(box.x0, x)
    box.x1 = Math.max(box.x1, x)
    box.y0 = Math.min(box.y0, y)
    box.y1 = Math.max(box.y1, y)
    box.color = colors[p]
  })

  const areas: (Area & { filled: number })[] = []
  boxes.forEach((box, n) => {
    // The area's pixels in a mask with a 1-pixel margin, holes filled: anything not
    // reached from the margin belongs to it. Smaller areas are drawn over the holes.
    const mw = box.x1 - box.x0 + 3
    const mh = box.y1 - box.y0 + 3
    const mask = new Uint8Array(mw * mh)
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        if (labels[y * width + x] === n) mask[(y - box.y0 + 1) * mw + x - box.x0 + 1] = 1
      }
    }
    const outside = new Uint8Array(mask.length)
    const stack = [0]
    outside[0] = 1
    while (stack.length) {
      const p = stack.pop()!
      const x = p % mw
      for (const q of [x > 0 ? p - 1 : -1, x < mw - 1 ? p + 1 : -1, p - mw, p + mw]) {
        if (q >= 0 && q < mask.length && !outside[q] && !mask[q]) {
          outside[q] = 1
          stack.push(q)
        }
      }
    }
    let filled = 0
    for (let i = 0; i < mask.length; i++) filled += mask[i] = outside[i] ? 0 : 1
    const corners = trace(mask, mw, mh).map(([x, y]): Point => [x - 1 + box.x0, y - 1 + box.y0])
    const points = simplifyOutline(corners, simplify)
    if (points.length >= 3) areas.push({ color: box.color, points, filled })
  })
  areas.sort((a, b) => b.filled - a.filled) // biggest first, so smaller ones go on top
  return {
    width,
    height,
    background: count.indexOf(Math.max(...count)),
    areas: areas.map(({ color, points }) => ({ color, points })),
  }
}

// Refuses images with more pixels than this, checked from the header before decoding.
const maxInputPixels = 300_000_000
const inputFormats = new Set(['jpeg', 'png', 'webp', 'gif'])

// Decodes an uploaded image (JPEG, PNG, WebP, GIF) and vectorizes it. Undefined when the
// bytes are not such an image, or it has too many pixels. libvips shrinks JPEG and WebP
// while decoding, so memory stays small however large the image is.
export async function pictureFromUpload(file: Buffer): Promise<Shapes | undefined> {
  try {
    const options = { limitInputPixels: maxInputPixels, failOn: 'error' } as const
    const { format } = await sharp(file, options).metadata()
    if (!format || !inputFormats.has(format)) return undefined
    const { data, info } = await sharp(file, options)
      .rotate() // applies the EXIF orientation
      .resize(size, size, { fit: 'inside' })
      .flatten({ background: '#ffffff' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (!info.width || !info.height) return undefined
    return vectorize({
      width: info.width,
      height: info.height,
      data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    })
  } catch {
    return undefined
  }
}

// The stored format, version 1. Varints are LEB128; deltas are zigzag varints.
//   u8 version | varint width | varint height | u8 background | varint area count
//   per area: u8 colour | varint point count | varint x | varint y | dx dy …
export function encodeShapes(shapes: Shapes): Buffer {
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
  return Buffer.from(out)
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
  check(width >= 1 && width <= size && height >= 1 && height <= size && background < 16)
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

// An outline as a smooth closed path: a quadratic curve through each corner's midpoints,
// with straight lines at corners on the picture's edge so the frame stays square.
function path(points: Point[], width: number, height: number): string {
  const n = points.length
  const round = (v: number) => String(Math.round(v * 10) / 10)
  const xy = ([x, y]: Point) => `${round(x)} ${round(y)}`
  const middle = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  let d = `M${xy(middle(points[n - 1], points[0]))}`
  points.forEach((point, i) => {
    const [x, y] = point
    const next = middle(point, points[(i + 1) % n])
    const edge = x <= 0 || y <= 0 || x >= width || y >= height
    d += edge ? `L${xy(point)}L${xy(next)}` : `Q${xy(point)} ${xy(next)}`
  })
  return `${d}Z`
}

// The picture as SVG. Only paths in the palette's colours: no markup comes from the data.
export function pictureSvg(bytes: Uint8Array): string {
  const { width, height, background, areas } = decodeShapes(bytes)
  const paths = areas
    .map(
      ({ color, points }) =>
        `<path fill="${pictureColors[color]}" d="${path(points, width, height)}"/>`,
    )
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${pictureColors[background]}"/>${paths}</svg>`
  )
}

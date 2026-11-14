import type { PicturePart } from '../avatar.ts'
import { photoOverlap } from '../avatar.ts'
import { decodeShapes, pictureColors, type Point } from './shapes.ts'

// Drawing stored shapes (shapes.ts) as SVG: for /pictures/{id}.svg and the profile
// picture's parts on the server, and for the preview in the browser before an upload.

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
// `top` and `bottom` (in the picture's pixels) show only that band of it: the two halves
// of a talking profile picture. `line` draws a dashed line across at that height (where
// the profile picture's mouth is, on the edit page).
export function pictureSvg(
  bytes: Uint8Array,
  { top, bottom, line }: { top?: number; bottom?: number; line?: number } = {},
): string {
  const { width, height, background, areas } = decodeShapes(bytes)
  const y0 = Math.max(0, Math.min(height, top ?? 0))
  const y1 = Math.max(y0, Math.min(height, bottom ?? height))
  const paths = areas
    .map(
      ({ color, points }) =>
        `<path fill="${pictureColors[color]}" d="${path(points, width, height)}"/>`,
    )
    .join('')
  const dashes =
    line === undefined
      ? ''
      : [
          ['#16141f', 9, ''],
          ['#f7f4ea', 5, ' stroke-dasharray="16 10"'],
        ]
          .map(
            ([color, strokeWidth, dash]) =>
              `<path d="M0 ${Math.round(line)}H${width}" stroke="${color}" stroke-width="${strokeWidth}"${dash}/>`,
          )
          .join('')
  // width and height give the SVG its aspect ratio as an <img> (the halves stack by it).
  const sized =
    top === undefined && bottom === undefined ? '' : ` width="${width}" height="${y1 - y0}"`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${y0} ${width} ${y1 - y0}"${sized}>` +
    `<rect width="${width}" height="${height}" fill="${pictureColors[background]}"/>${paths}${dashes}</svg>`
  )
}

// A part of a profile picture whose mouth is `cut` percent from the top (photoUrl in
// src/shared/avatar.ts): `top` and `jaw`, the bands above and below the cut that flap
// apart to talk (the top one reaches photoOverlap further down, tucked behind the jaw),
// and `edit`, the whole picture with the cut drawn across it.
export function photoPartSvg(bytes: Uint8Array, cut: number, part: PicturePart): string {
  const line = Math.round((decodeShapes(bytes).height * cut) / 100)
  return part === 'top'
    ? pictureSvg(bytes, { top: 0, bottom: line + photoOverlap })
    : part === 'jaw'
      ? pictureSvg(bytes, { top: line })
      : pictureSvg(bytes, { line })
}

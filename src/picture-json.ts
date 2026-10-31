import type { Request } from 'express'
import { pictureSvg } from './picture.ts'
import { getPicturesShapes } from './routes/state.ts'

// How a blurt's picture is given in JSON, picked with `?pictures=` on any GET:
//   data (default)  `data`: the stored drawing (src/picture.ts, encodeShapes) as base64
//   svg             `svg`: the drawing as SVG markup, the same as /pictures/{id}.svg
//   none            only `width`, `height` and `url`
// Every picture has `url` (/pictures/{id}.svg). An unknown value is the default.
export type PictureMode = 'data' | 'svg' | 'none'

export function pictureMode(request: Request): PictureMode {
  const { pictures } = request.query
  return pictures === 'svg' || pictures === 'none' ? pictures : 'data'
}

type Picture = { width: number; height: number }

function isPicturedBlurt(value: unknown): value is { id: number; picture: Picture } {
  if (typeof value !== 'object' || value === null || !('picture' in value) || !('id' in value)) {
    return false
  }
  const { id, picture } = value as { id: unknown; picture: unknown }
  return (
    typeof id === 'number' &&
    typeof picture === 'object' &&
    picture !== null &&
    typeof (picture as Picture).width === 'number' &&
    typeof (picture as Picture).height === 'number'
  )
}

// The ids of every blurt with a picture anywhere in `data` (feeds, threads, search…).
function picturedIds(data: unknown, ids = new Set<number>(), seen = new Set<object>()) {
  if (typeof data !== 'object' || data === null || seen.has(data) || data instanceof Date) {
    return ids
  }
  seen.add(data)
  if (isPicturedBlurt(data)) {
    ids.add(data.id)
  }
  for (const value of Array.isArray(data) ? data : Object.values(data)) {
    picturedIds(value, ids, seen)
  }
  return ids
}

// A JSON.stringify replacer that adds `url`, and `data` or `svg`, to each blurt's picture.
// Undefined when `data` has no pictures. The pictures are fetched in one query.
export async function pictureReplacer(
  data: unknown,
  mode: PictureMode,
): Promise<((holder: unknown, key: string, value: unknown) => unknown) | undefined> {
  const ids = [...picturedIds(data)]
  if (ids.length === 0) {
    return undefined
  }
  const shapes = mode === 'none' ? new Map<number, Buffer>() : await getPicturesShapes(ids)
  return (holder, key, value) => {
    if (key !== 'picture' || !isPicturedBlurt(holder) || holder.picture !== value) {
      return value
    }
    const { id, picture } = holder
    const stored = shapes.get(id)
    return {
      ...picture,
      url: `/pictures/${id}.svg`,
      ...(stored && mode === 'data' && { data: stored.toString('base64') }),
      ...(stored && mode === 'svg' && { svg: pictureSvg(stored) }),
    }
  }
}

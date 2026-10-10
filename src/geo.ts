// Coarse geography for profile locations (ticket 013a): the grid every stored point is
// snapped to, and the world map image people click to pick one.

// A point on the earth. On a profile it is always the centre of a grid cell.
export type GeoPoint = { lat: number; lon: number }

// Locations are only ever stored as the centre of a cell this many degrees on each side
// (1° is about 110 km north-south). Whatever precision a client sends, it is snapped
// first. A CHECK in db/migrations/*_profile-location.sql enforces it, so changing this
// needs a migration too.
export const gridDegrees = 1

// public/world-map.svg, served at `mapUrl`: equirectangular, 2 px per degree, so x is
// longitude and y latitude. Its pixel size must match, for the click maths.
export const mapWidth = 720
export const mapHeight = 360
export const mapUrl = '/static/world-map.svg'

// The centre of the grid cell the point falls in. Longitude wraps around (180 is -180).
export function snapToGrid({ lat, lon }: GeoPoint): GeoPoint {
  const cells = 180 / gridDegrees
  const row = Math.min(Math.floor((lat + 90) / gridDegrees), cells - 1) // 90°N is in the top row
  const column = Math.floor(((((lon + 180) % 360) + 360) % 360) / gridDegrees)
  return {
    lat: -90 + (row + 0.5) * gridDegrees,
    lon: -180 + (column + 0.5) * gridDegrees,
  }
}

// A pixel on the map to the point under the middle of it (not yet snapped).
export function pixelToPoint(x: number, y: number): GeoPoint {
  return {
    lat: 90 - ((y + 0.5) / mapHeight) * 180,
    lon: ((x + 0.5) / mapWidth) * 360 - 180,
  }
}

// Where a point is drawn on the map, for the marker on the edit page.
export function pointToPixel({ lat, lon }: GeoPoint): { x: number; y: number } {
  return { x: ((lon + 180) / 360) * mapWidth, y: ((90 - lat) / 180) * mapHeight }
}

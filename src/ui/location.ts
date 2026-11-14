import {
  formatLocation,
  gridDescription,
  mapHeight,
  mapWidth,
  pointToPixel,
} from '../shared/geo.ts'
import type { GeoPoint } from '../shared/geo.ts'
import { html } from './html.ts'

// The parts of the location panel on the edit page that show what is stored: rendered on
// the server, and again in the browser by the map's script (src/client/map.ts) after a
// click saved without a page load, so both always read the same.

export function LocationStatus({ location }: { location: GeoPoint | null }) {
  return html`<p class="location-status">
    ${
      location
        ? html`${'Your location: '}<strong>${formatLocation(location)}</strong>${` (the middle of ${gridDescription}).`}`
        : "You haven't set a location."
    }
  </p>`
}

// The marker over the map: an SVG as large as the map, its circle on the stored point.
export function MapMarker({ location }: { location: GeoPoint }) {
  const { x, y } = pointToPixel(location)
  return html`<svg
    class="map-marker"
    width=${mapWidth}
    height=${mapHeight}
    viewBox="0 0 ${mapWidth} ${mapHeight}"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx=${x} cy=${y} r="6" fill="#a32020" stroke="#fffdf8" stroke-width="2" />
  </svg>`
}

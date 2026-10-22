import { Router, type Request } from 'express'
import { mapHeight, mapWidth, pixelToPoint, snapToGrid, type GeoPoint } from '../geo.ts'
import { clearSessionCookies, requireAuth, setSessionTime } from '../middleware/auth.ts'
import { timeZoneAt } from '../timezones.ts'
import { accountKey, rateLimit } from '../middleware/rate-limit.ts'
import { represent, sendError, sendFormErrors, sendFormSuccess, wantsJson } from '../negotiate.ts'
import {
  getLocation,
  getNotificationSettings,
  getUserProfileByUsername,
  listNearbyBlurts,
  markViewerFlags,
  parseCursor,
  setLocation,
  setTimeSettings,
} from './state.ts'
import { renderNearPage, renderProfileEditPage } from '../templates/index.ts'
import { nearMarkdown } from '../templates/pages.md.ts'

export const locationRouter = Router()

// "Blurts near you" radii in km. The first page shows `defaultRadius`.
export const nearRadii = [50, 100, 250, 500, 1000, 2500]
const defaultRadius = 250

type LocationInput =
  | { clear: true }
  | { point: GeoPoint }
  | { error: { field?: string; message: string } }

function isGiven(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && value !== false
}

// A number from a form field (string) or JSON (number). Undefined if it isn't one.
function toNumber(value: unknown): number | undefined {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined
}

// The body of POST /api/location, any of: `clear` (the "Remove my location" button or
// `{ clear: true }`), `location.x` + `location.y` (a click on the map image) or `lat` +
// `lon` (JSON, for API clients: the edit page has no form for it).
export function parseLocationInput(body: unknown): LocationInput {
  const values = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  if (isGiven(values.clear)) {
    return { clear: true }
  }

  if (isGiven(values['location.x']) || isGiven(values['location.y'])) {
    const x = toNumber(values['location.x'])
    const y = toNumber(values['location.y'])
    // Activating the image from the keyboard submits 0,0: no real click.
    if (x === 0 && y === 0) {
      return {
        error: {
          field: 'location',
          message: 'Click a spot on the map.',
        },
      }
    }
    if (
      x === undefined ||
      y === undefined ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= mapWidth ||
      y >= mapHeight
    ) {
      return { error: { field: 'location', message: 'That spot is outside the map.' } }
    }
    return { point: snapToGrid(pixelToPoint(x, y)) }
  }

  const lat = toNumber(values.lat)
  const lon = toNumber(values.lon)
  if (lat === undefined || lat < -90 || lat > 90) {
    return { error: { field: 'lat', message: 'Latitude must be a number from -90 to 90.' } }
  }
  if (lon === undefined || lon < -180 || lon > 180) {
    return { error: { field: 'lon', message: 'Longitude must be a number from -180 to 180.' } }
  }
  return { point: snapToGrid({ lat, lon }) }
}

// Sets, moves or clears the viewer's location. Forms go back to the edit page, which shows
// what is stored; JSON callers get `{ location }`.
locationRouter.post(
  '/api/location',
  requireAuth,
  rateLimit('location', accountKey),
  async (request, response) => {
    const viewer = response.locals.authenticatedUser
    const input = parseLocationInput(request.body)

    if ('error' in input) {
      const profile = await getUserProfileByUsername(viewer.username)
      if (!profile) {
        sendError(request, response, 404, 'User not found')
        return
      }
      const location = await getLocation(viewer.id)
      const notifications = await getNotificationSettings(viewer.id)
      await sendFormErrors(request, response, [input.error], (locationError) =>
        renderProfileEditPage({ viewer, profile, location, notifications, locationError }),
      )
      return
    }

    const location = 'point' in input ? input.point : null
    if (!(await setLocation(viewer.id, location))) {
      // A still-valid token for a user that no longer exists (e.g. after a database reset).
      clearSessionCookies(response)
      if (wantsJson(request)) {
        sendError(request, response, 401, 'Authentication required')
      } else {
        response.redirect(303, '/')
      }
      return
    }

    // Setting a location also sets the time zone of that place. Removing it leaves the zone.
    const timeZone = location ? timeZoneAt(location) : undefined
    if (timeZone && (await setTimeSettings(viewer.id, { timeZone }))) {
      await setSessionTime(request, response, { timeZone })
    }

    sendFormSuccess(request, response, {
      redirect: request.body?.return === 'near' ? '/near' : `/${viewer.username}/edit#location`,
      data: { location },
    })
  },
)

function parseRadius(request: Request): number | undefined {
  const value = request.query.radius
  if (value === undefined) {
    return defaultRadius
  }
  const radius = typeof value === 'string' && /^\d{1,5}$/.test(value) ? Number(value) : NaN
  return nearRadii.includes(radius) ? radius : undefined
}

// "Blurts near you": blurts from people whose profile location is within `radius` km of
// the viewer's. The viewer's own location is in the data; nobody else's ever is.
locationRouter.get('/near', requireAuth, async (request, response) => {
  const viewer = response.locals.authenticatedUser
  const radius = parseRadius(request)
  if (radius === undefined) {
    sendError(request, response, 400, `Radius must be one of ${nearRadii.join(', ')} km`, 'radius')
    return
  }
  const before = parseCursor(request.query.before)
  if (before === undefined) {
    sendError(request, response, 400, 'Invalid cursor', 'before')
    return
  }

  const location = await getLocation(viewer.id)
  const { items: blurts, next } = location
    ? await listNearbyBlurts(viewer.id, radius, before)
    : { items: [], next: null }
  await markViewerFlags(viewer.id, blurts)
  represent(
    request,
    response,
    { viewer, location, radius, radii: nearRadii, blurts, next },
    { html: renderNearPage, markdown: nearMarkdown },
  )
})

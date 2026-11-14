import { render, type ComponentChild } from 'preact'
import { gridDegrees, mapHeight, mapWidth, pointToPixel, type GeoPoint } from '../shared/geo.ts'
import { html } from '../ui/html.ts'
import { LocationStatus, MapMarker } from '../ui/location.ts'
import type { EnhancerContext } from './enhance.ts'
import { submitForm, type Outcome } from './requests.ts'
import { applyTimeSettings } from './times.ts'

// <form class="map-form" data-enhance="map">: the location map on the edit page (and on
// /near). Without JavaScript a click on the map image submits the pixel and the page
// comes back with the marker on the stored spot. With this, the click is the same POST,
// sent with fetch(); the answer `{ location, timeZone }` moves the marker, rewrites the
// "Your location" line and selects the place's time zone, with no page load.
//
// The keyboard: with the map focused, the arrow keys move a hollow marker one grid cell
// (Shift: ten), and Enter or Space saves it there. (Without JavaScript an image button
// can't be aimed from the keyboard at all; the server refuses its 0,0.)
//
// The "Remove my location" form next to it is sent with fetch() too. On /near the page's
// blurts depend on the location, so there a saved click loads /near again, as the form's
// own redirect would.

// Pixels per grid cell on the map (2 px per degree).
const cell = (mapWidth / 360) * gridDegrees
const columns = Math.round(mapWidth / cell)
const rows = Math.round(mapHeight / cell)

type Cursor = { column: number; row: number }

function cursorAt(location: GeoPoint | null): Cursor {
  const { x, y } = location ? pointToPixel(location) : { x: mapWidth / 2, y: mapHeight / 2 }
  return {
    column: Math.min(columns - 1, Math.floor(x / cell)),
    row: Math.min(rows - 1, Math.floor(y / cell)),
  }
}

// The pixel in the middle of a cell: never 0,0, which the server takes for a keyboard.
function pixelOf({ column, row }: Cursor): { x: number; y: number } {
  return { x: Math.floor(column * cell + cell / 2), y: Math.floor(row * cell + cell / 2) }
}

// Puts a freshly rendered component in place of `old` (server markup).
function replace(old: Element, vnode: ComponentChild): Element | null {
  const holder = document.createElement('div')
  render(vnode, holder)
  const fresh = holder.firstElementChild
  if (fresh) {
    old.replaceWith(fresh)
  }
  return fresh
}

const keyHelp =
  'With the keyboard: the arrow keys move the marker one square (with Shift ten), Enter or Space sets your location there.'

export function enhance(element: HTMLElement, context: EnhancerContext): void {
  if (!(element instanceof HTMLFormElement)) {
    throw new Error('map needs a <form>')
  }
  const form = element
  const input = form.querySelector<HTMLInputElement>('input[type=image][name=location]')
  const inner = form.querySelector('.map-inner')
  if (!input || !inner) {
    throw new Error('map: no map image')
  }
  const section = form.closest('section')
  const clearForm = section?.querySelector<HTMLFormElement>('form.location-clear') ?? null
  const toNear = form.elements.namedItem('return') !== null

  // Where the stored location is, from the marker the server drew (or none).
  const circle = inner.querySelector('.map-marker circle')
  let saved: GeoPoint | null = circle
    ? {
        lat: 90 - (Number(circle.getAttribute('cy')) / mapHeight) * 180,
        lon: (Number(circle.getAttribute('cx')) / mapWidth) * 360 - 180,
      }
    : null
  let cursor = cursorAt(saved)
  let moved = false // the cursor is away from the stored spot

  const help = document.createElement('p')
  help.className = 'tiny'
  help.id = `map-keys-${Math.random().toString(36).slice(2)}`
  help.textContent = keyHelp
  form.after(help)
  input.setAttribute('aria-describedby', help.id)

  // Errors and progress, announced, under the map.
  const message = document.createElement('p')
  message.setAttribute('role', 'status')
  message.className = 'tiny'
  help.after(message)
  const say = (text: string, error = false) => {
    message.textContent = text
    message.classList.toggle('validation-error', error)
  }

  const drawMarker = (location: GeoPoint | null, pending = false) => {
    const old = inner.querySelector('.map-marker')
    if (!location) {
      old?.remove()
      return
    }
    const holder = document.createElement('div')
    render(html`<${MapMarker} location=${location} />`, holder)
    const fresh = holder.firstElementChild
    if (!fresh) {
      return
    }
    fresh.classList.toggle('map-marker-pending', pending)
    if (old) {
      old.replaceWith(fresh)
    } else {
      inner.append(fresh)
    }
  }

  const showSaved = (location: GeoPoint | null) => {
    saved = location
    cursor = cursorAt(location)
    moved = false
    drawMarker(location)
    const status = section?.querySelector('.location-status')
    if (status) {
      replace(status, html`<${LocationStatus} location=${location} />`)?.setAttribute(
        'aria-live',
        'polite',
      )
    }
    if (clearForm) {
      clearForm.hidden = !location
    }
  }

  const answered = (
    outcome: Outcome<{ location?: GeoPoint | null; timeZone?: string | null }>,
  ): void => {
    if (outcome.kind === 'fallback') {
      return
    }
    if (outcome.kind === 'success') {
      if (toNear) {
        location.assign('/near')
        return
      }
      showSaved(outcome.data?.location ?? null)
      const timeZone = outcome.data?.timeZone
      if (timeZone) {
        // The time zone form shows the zone it was set to (no change event: nothing to save).
        const select = document.querySelector<HTMLSelectElement>(
          'form[action="/api/timezone"] select[name=timezone]',
        )
        if (select) {
          select.value = timeZone
        }
        applyTimeSettings({ timeZone }, context.page)
      }
      say(outcome.data?.location ? 'Location saved.' : 'Location removed.')
    } else if (outcome.kind === 'errors') {
      say(outcome.errors.map((error) => error.message).join(' '), true)
    } else {
      say('Not saved: no answer from the server. Try again.', true)
    }
  }

  // One request at a time; a click while one is on its way waits for it, and only the
  // newest of those is sent.
  let busy = false
  let next: Record<string, string> | null = null
  const send = async (fields: Record<string, string>): Promise<void> => {
    if (busy) {
      next = fields
      return
    }
    busy = true
    say('Saving…')
    try {
      answered(await submitForm(form, { submitter: input, fields, fallback: false }))
    } finally {
      busy = false
    }
    const queued = next
    next = null
    if (queued) {
      await send(queued)
    }
  }

  const saveCursor = () => {
    if (!moved && !saved) {
      say('Move the marker with the arrow keys first, then press Enter.', true)
      return
    }
    const { x, y } = pixelOf(cursor)
    void send({ 'location.x': String(x), 'location.y': String(y) })
  }

  input.addEventListener('click', (event) => {
    event.preventDefault()
    // A click from the keyboard (Enter, Space) has no position: save the cursor's cell.
    if (event.detail === 0) {
      saveCursor()
      return
    }
    // The click in the image's own pixels, should CSS ever draw it at another size.
    const x = Math.floor((event.offsetX * mapWidth) / (input.clientWidth || mapWidth))
    const y = Math.floor((event.offsetY * mapHeight) / (input.clientHeight || mapHeight))
    if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) {
      return
    }
    // 0,0 is a real spot here, but the server takes it for a keyboard: use the next pixel.
    void send({ 'location.x': String(x || 1), 'location.y': String(y) })
  })
  // Any other way the form gets submitted (implicit submission): as a keyboard save.
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    saveCursor()
  })

  const steps: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }
  input.addEventListener('keydown', (event) => {
    const step = steps[event.key]
    if (!step) {
      return
    }
    event.preventDefault()
    const by = event.shiftKey ? 10 : 1
    cursor = {
      // Longitude wraps around; latitude stops at the poles.
      column: (((cursor.column + step[0] * by) % columns) + columns) % columns,
      row: Math.min(rows - 1, Math.max(0, cursor.row + step[1] * by)),
    }
    moved = true
    const { x, y } = pixelOf(cursor)
    drawMarker(
      { lat: 90 - ((y + 0.5) / mapHeight) * 180, lon: ((x + 0.5) / mapWidth) * 360 - 180 },
      true,
    )
    say('Press Enter to set your location here.')
  })
  // Leaving the map with an unsaved cursor: back to what is stored.
  input.addEventListener('blur', () => {
    if (moved) {
      cursor = cursorAt(saved)
      moved = false
      drawMarker(saved)
      say('')
    }
  })

  clearForm?.addEventListener('submit', (event) => {
    event.preventDefault()
    void (async () => {
      say('Removing…')
      const outcome = await submitForm<{ location?: GeoPoint | null }>(clearForm, {
        submitter: event.submitter,
      })
      answered(outcome)
      if (outcome.kind === 'success') {
        // Its button is gone now; keep focus nearby.
        input.focus()
      }
    })()
  })
}

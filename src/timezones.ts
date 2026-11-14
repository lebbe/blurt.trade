import tzLookup from 'tz-lookup'
import { isTimeZone } from './shared/time-zones.ts'

// Time zones and locales, and how timestamps are written in them, are in
// src/shared/time-zones.ts (plain Intl, so the browser can use them too). This module adds
// the lookup of a place's zone, whose table is too big to send to a browser.
export * from './shared/time-zones.ts'

// The zone a place is in, for setting it along with a location. Undefined where the lookup
// finds none or names one the picker doesn't list. Old aliases (Europe/Kiev) are mapped to
// the canonical name (Europe/Kyiv) first.
export function timeZoneAt({ lat, lon }: { lat: number; lon: number }): string | undefined {
  try {
    const { timeZone } = new Intl.DateTimeFormat('en', {
      timeZone: tzLookup(lat, lon),
    }).resolvedOptions()
    return isTimeZone(timeZone) ? timeZone : undefined
  } catch {
    return undefined
  }
}

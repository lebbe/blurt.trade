// Time zones for showing timestamps. The database keeps every moment as timestamptz (UTC);
// only the display depends on the viewer. The zone is a profile setting
// (user_profiles.timezone, NULL until picked) and travels in the access token, like the
// theme. Browsers send no time zone and the site runs without JS, so everyone who hasn't
// picked one, logged out visitors included, gets UTC, and the zone is always shown next to
// the time. The 12 or 24 hour clock follows the browser's Accept-Language instead.
import tzLookup from 'tz-lookup'

export const defaultTimeZone = 'UTC'

// IANA names ("Europe/Oslo"). UTC is added by hand: not every runtime lists it.
export const timeZones: readonly string[] = [
  defaultTimeZone,
  ...Intl.supportedValuesOf('timeZone').filter((zone) => zone !== defaultTimeZone),
]

const known = new Set(timeZones)

export function isTimeZone(value: unknown): value is string {
  return typeof value === 'string' && known.has(value)
}

// For stored or token values that might not be valid (an older runtime's list, a stale token).
export function timeZoneOrDefault(value: unknown): string {
  return isTimeZone(value) ? value : defaultTimeZone
}

// The first language in Accept-Language that Intl knows, else British English, whose clock
// is 24 hours and whose dates are day first.
export function localeFrom(languages: readonly string[]): string {
  for (const language of languages) {
    try {
      const [locale] = Intl.DateTimeFormat.supportedLocalesOf(language)
      if (locale) {
        return locale
      }
    } catch {
      // A malformed tag: try the next one.
    }
  }
  return 'en-GB'
}

// The languages a user can pick for dates and times on their edit page (user_profiles.locale,
// NULL until picked: then the browser's Accept-Language decides). Labels come from Intl.
export const locales: readonly string[] = [
  'nb-NO',
  'nn-NO',
  'da-DK',
  'sv-SE',
  'fi-FI',
  'is-IS',
  'en-GB',
  'en-US',
  'en-CA',
  'en-AU',
  'de-DE',
  'fr-FR',
  'es-ES',
  'it-IT',
  'nl-NL',
  'pl-PL',
  'pt-PT',
]

export function isLocale(value: unknown): value is string {
  return typeof value === 'string' && locales.includes(value)
}

const localeNames = new Intl.DisplayNames(['en'], { type: 'language' })

export function localeLabel(locale: string): string {
  return localeNames.of(locale) ?? locale
}

// "17.10.2026 14:37" or "10/17/2026 02:37 PM", by locale. The zone's name is added only
// for UTC, the default: a reminder that it's not the viewer's own time unless they pick one.
export function formatTimestamp(date: Date, timeZone: string, locale: string): string {
  const day = date.toLocaleDateString(locale, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const time = date.toLocaleTimeString(locale, { timeZone, hour: '2-digit', minute: '2-digit' })
  return `${day} ${time}${timeZone === defaultTimeZone ? ' UTC' : ''}`
}

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

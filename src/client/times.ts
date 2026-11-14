import { formatTimestamp } from '../shared/time-zones.ts'
import type { PageContext } from '../ui/context.ts'
import { updatePageContext } from './page-context.ts'

// After the time zone or language changed without a page load: every timestamp on the page
// written again in the new ones, with the same formatTimestamp the server uses (Timestamp
// in src/ui/blurt-card.ts), so it reads exactly as a fresh page would. Only <time>s that
// show a timestamp the old way are touched; others (an invite's expiry date) say
// something else and stay.
export function applyTimeSettings(
  display: { timeZone?: unknown; locale?: unknown } | undefined,
  page: PageContext,
  doc: Document = document,
): void {
  const timeZone = typeof display?.timeZone === 'string' ? display.timeZone : page.timeZone
  const locale = typeof display?.locale === 'string' ? display.locale : page.locale
  if (timeZone === page.timeZone && locale === page.locale) {
    return
  }
  try {
    for (const element of doc.querySelectorAll('time[datetime]')) {
      const date = new Date(element.getAttribute('datetime') ?? '')
      if (
        Number.isNaN(date.getTime()) ||
        element.textContent?.trim() !== formatTimestamp(date, page.timeZone, page.locale)
      ) {
        continue
      }
      element.textContent = formatTimestamp(date, timeZone, locale)
    }
  } catch (error) {
    // A zone or language this browser's Intl doesn't know: the times stay as they were
    // and are right after the next page load.
    console.warn('Could not rewrite the times', error)
    return
  }
  updatePageContext(page, { timeZone, locale }, doc)
}

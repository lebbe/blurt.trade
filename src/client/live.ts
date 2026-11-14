import type { PageContext } from '../ui/context.ts'
import { html } from '../ui/html.ts'
import { NavLink, navItems } from '../ui/nav.ts'
import { UnreadBadge } from '../ui/notifications.ts'
import { notificationsPath } from '../ui/urls.ts'
import { updatePageContext } from './page-context.ts'
import { renderElement, renderNodes, replaceRendered } from './render.ts'

// Live updates for logged-in viewers, started by main.ts on every page: one EventSource
// on /api/events (src/events.ts), for as long as the page is shown.
//
//   - `unread` updates the notification count wherever the page shows it: the Alerts link
//     in the main navigation (added or taken away, as the server would render it), the
//     Notifications link in Your corner, the page context, and the app badge of an
//     installed app.
//   - `blurts` is passed on as a `live:blurts` event on document, for the feed's "N new
//     blurts" banner (./new-blurts.ts), which decides what is new to its own list.
//
// The connection is closed on pagehide and opened again on pageshow: an open connection
// keeps a page out of the back/forward cache in some browsers, and a page in that cache
// needs none. EventSource reconnects by itself after the server ends a stream (every few
// minutes, src/routes/events.ts) or the network drops. When the server refuses it (logged
// out, too many tabs, rate limit), EventSource gives up; this tries again later, slower
// each time.

export type LiveBlurt = { id: number; everyone: boolean; following: boolean }

const firstRetryMs = 60_000
const maxRetryMs = 10 * 60_000

export function start(page: PageContext): void {
  if (!page.viewer || typeof EventSource !== 'function') {
    return
  }
  let source: EventSource | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let wait = firstRetryMs

  const open = () => {
    if (source) {
      return
    }
    const current = new EventSource('/api/events')
    source = current
    current.addEventListener('open', () => {
      wait = firstRetryMs
      document.documentElement.dataset.live = 'open'
    })
    current.addEventListener('unread', (event) => {
      const { unread } = JSON.parse((event as MessageEvent<string>).data) as { unread: number }
      showUnread(page, unread)
    })
    current.addEventListener('blurts', (event) => {
      const blurts = JSON.parse((event as MessageEvent<string>).data) as LiveBlurt[]
      document.dispatchEvent(new CustomEvent('live:blurts', { detail: blurts }))
    })
    current.addEventListener('error', () => {
      if (current.readyState === EventSource.CLOSED && source === current) {
        close()
        retry = setTimeout(open, wait)
        wait = Math.min(wait * 2, maxRetryMs)
      } else {
        delete document.documentElement.dataset.live
      }
    })
  }
  const close = () => {
    clearTimeout(retry)
    source?.close()
    source = undefined
    delete document.documentElement.dataset.live
  }

  addEventListener('pagehide', close)
  addEventListener('pageshow', (event) => {
    if (event.persisted) {
      open()
    }
  })
  open()
}

// Everywhere the page shows the count, as the server would have rendered it with `unread`.
export function showUnread(page: PageContext, unread: number): void {
  if (!page.viewer || page.unreadNotifications === unread) {
    return
  }
  updatePageContext(page, { unreadNotifications: unread })
  const href = notificationsPath(page.viewer.username)

  // The main navigation: its Alerts link is only there while something is unread.
  const nav = document.querySelector('nav.top-nav')
  if (nav) {
    const items = navItems(page)
    const index = items.findIndex((item) => item.href === href)
    const link = nav.querySelector(`:scope > a[href="${href}"]`)
    if (index === -1) {
      link?.remove()
    } else if (link) {
      replaceRendered(link, html`<${NavLink} item=${items[index]} />`, page)
    } else {
      const fresh = renderElement(html`<${NavLink} item=${items[index]} />`, page)
      const next = items[index + 1]
      const before = next && nav.querySelector(`:scope > a[href="${next.href}"]`)
      if (before) {
        before.before(fresh)
      } else {
        nav.querySelector(':scope > form')?.before(fresh)
      }
    }
  }

  // Other links to the notifications (Your corner): "Notifications" plus the badge.
  for (const link of document.querySelectorAll<HTMLAnchorElement>(`a[href="${href}"]`)) {
    if (
      link.closest('nav.top-nav') ||
      link.textContent?.trim().split(/\s/)[0] !== 'Notifications'
    ) {
      continue
    }
    link.replaceChildren(
      unread > 0 ? 'Notifications ' : 'Notifications',
      ...(unread > 0 ? renderNodes(html`<${UnreadBadge} unread=${unread} />`, page) : []),
    )
  }

  // An installed app's icon (desktop, Android, iOS from the Home Screen).
  if (matchMedia('(display-mode: standalone)').matches) {
    const badge = navigator as Navigator & {
      setAppBadge?: (count: number) => Promise<void>
      clearAppBadge?: () => Promise<void>
    }
    void (unread > 0 ? badge.setAppBadge?.(unread) : badge.clearAppBadge?.())?.catch(() => {})
  }
}

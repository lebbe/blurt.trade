// The service worker, served at /sw.js (src/routes/push.ts) and registered only when the
// user asks for notifications on a device ("Notify me on this device", ./push.ts). It does
// one thing: show notifications when the server pushes. It has no fetch handler, so it
// never stands between the browser and the site: pages, scripts and everything else load
// from the network exactly as without it, and nothing is cached.
//
// Pushes carry nothing (src/push.ts). On one, the worker asks us what is unread, with the
// browser's own cookies, as JSON from /notifications/ (which redirects to the user's
// /:username/notifications/), and shows one notification for all of it: the newest one's
// words when there is one, "3 new notifications" when there are more. Every notification
// has the same tag, so a new one replaces the last instead of piling up. Clicking opens
// the blurt (or the notifications page). The app badge (installed apps) shows the count.
//
// A classic script, with no imports: module service workers aren't everywhere yet, and
// the page's import map never applies to workers. So the verbs are a copy of
// notificationVerbs in src/ui/notifications.ts (test/push.test.ts checks they match).

type Unread = {
  unread: number
  notifications: {
    kind: string
    actor: string
    blurtId: number
    blurtUsername: string
    text: string | null
    createdAt: string
  }[]
}

type WaitableEvent = Event & { waitUntil(promise: Promise<unknown>): void }
type ClickEvent = WaitableEvent & { notification: Notification & { data?: { url?: string } } }
type WindowClient = { url: string; focus(): Promise<unknown> }
type WorkerScope = {
  registration: {
    showNotification(
      title: string,
      options: NotificationOptions & Record<string, unknown>,
    ): Promise<void>
    getNotifications(filter?: { tag?: string }): Promise<Notification[]>
  }
  clients: {
    claim(): Promise<void>
    matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<WindowClient[]>
    openWindow(url: string): Promise<unknown>
  }
  skipWaiting(): Promise<void>
  navigator: { setAppBadge?(count: number): Promise<void>; clearAppBadge?(): Promise<void> }
  location: { origin: string }
  addEventListener(type: string, listener: (event: never) => void): void
}

const worker = self as unknown as WorkerScope
const tag = 'notifications'
const notificationsUrl = '/notifications/'

const verbs: Record<string, string> = {
  followed_blurt: 'blurted',
  reply: 'replied to your blurt',
  reblurt: 'reblurted your blurt',
  quote: 'quoted your blurt',
}

function preview(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function label(unread: number): string {
  return unread > 99 ? '99+' : String(unread)
}

// A new version replaces the running one at once, rather than after every tab closes:
// it holds no state, so nothing is lost by switching mid-way.
worker.addEventListener('install', (event: WaitableEvent) => {
  event.waitUntil(worker.skipWaiting())
})
worker.addEventListener('activate', (event: WaitableEvent) => {
  event.waitUntil(worker.clients.claim())
})

async function badge(unread: number): Promise<void> {
  try {
    await (unread > 0 ? worker.navigator.setAppBadge?.(unread) : worker.navigator.clearAppBadge?.())
  } catch {
    // Not supported, or not an installed app: nothing to show it on.
  }
}

async function fetchUnread(): Promise<Unread | undefined> {
  try {
    const response = await fetch(notificationsUrl, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    })
    if (!response.ok || !response.headers.get('Content-Type')?.includes('json')) {
      return undefined
    }
    return (await response.json()) as Unread
  } catch {
    return undefined
  }
}

async function showUnread(): Promise<void> {
  const data = await fetchUnread()
  const shown = await worker.registration.getNotifications({ tag })
  if (!data) {
    // Not logged in any more, or the site is unreachable. A push must show something
    // (browsers insist), so a plain pointer to the notifications page.
    await worker.registration.showNotification('blurt.trade', {
      tag,
      body: 'You may have new notifications.',
      icon: '/static/icons/icon-192.png',
      badge: '/static/icons/badge-96.png',
      data: { url: notificationsUrl },
    })
    return
  }
  await badge(data.unread)
  const [newest] = data.notifications
  if (data.unread === 0 || !newest) {
    // Read meanwhile (on another device, say): take the old one away.
    for (const notification of shown) {
      notification.close()
    }
    return
  }
  const one = data.unread === 1
  const title = one
    ? `${newest.actor} ${verbs[newest.kind] ?? 'did something'}`
    : `${label(data.unread)} new notifications`
  const body = one
    ? preview(newest.text ?? '', 140)
    : data.notifications
        .slice(0, 3)
        .map((item) => `${item.actor} ${verbs[item.kind] ?? ''}`.trim())
        .join('\n')
  await worker.registration.showNotification(title, {
    tag,
    // Replacing the last one still pings: there is something new.
    renotify: true,
    body,
    icon: '/static/icons/icon-192.png',
    badge: '/static/icons/badge-96.png',
    timestamp: Date.parse(newest.createdAt) || Date.now(),
    data: { url: one ? `/${newest.blurtUsername}/${newest.blurtId}` : notificationsUrl },
  })
}

worker.addEventListener('push', (event: WaitableEvent) => {
  event.waitUntil(showUnread())
})

// Opens what the notification is about, or brings a tab that already shows it forward.
worker.addEventListener('notificationclick', (event: ClickEvent) => {
  event.notification.close()
  const path = event.notification.data?.url ?? notificationsUrl
  const url = new URL(path, worker.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows.find((client) => client.url === url)
      await (open ? open.focus() : worker.clients.openWindow(url))
    })(),
  )
})

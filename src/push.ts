import { importJWK, SignJWT } from 'jose'
import { contact, publicUrl } from './config.ts'
import { onCloseDb } from './db.ts'
import { errorFields, log } from './logging.ts'
import { countUnreadFromPrimary } from './routes/state/notifications.ts'
import { claimPushEndpoints, forgetPushEndpoint } from './routes/state/push.ts'
import { vapidProblem } from './vapid.ts'

// Web Push, without payloads. When a notification is saved, the instance that saved it
// (addBlurt, setReblurt) calls pushNotifications() for the users it notified. For each of
// their devices that asked for it (push_subscriptions) it sends an empty POST to the
// device's push service (Google's, Mozilla's, Apple's, Microsoft's: whoever made the
// browser), which wakes our service worker (src/client/sw.ts) there. The worker then
// fetches the notifications from us, with the browser's own cookies, and shows them. So
// nothing about the notification passes through the push service, and nothing needs
// encrypting: the push is only "look now".
//
// Each push is signed with our VAPID key (RFC 8292): an ES256 JWT for the push service's
// origin, so the service knows the push comes from whoever the browser subscribed with
// (the public key is in the edit page, src/client/push.ts). Without VAPID_PUBLIC_KEY and
// VAPID_PRIVATE_KEY, push is off: the button isn't shown and nothing is sent.
//
// Grouping: a device is pushed to at most once per pushIntervalSeconds. A notification
// within that time doesn't push; one push follows when the time is up, if anything is
// still unread then. With "Topic" the push service also keeps only the newest undelivered
// push per device (a phone that was off gets one, not thirty). And the worker shows one
// notification for everything unread, replacing the last one (its `tag`), so thirty likes
// are at most one ping a minute, and one notification.

export let pushIntervalSeconds = 60

// For tests: a shorter interval, so the push that follows one can be waited for.
export function setPushIntervalSeconds(seconds: number): void {
  pushIntervalSeconds = seconds
}
const pushTtlSeconds = 24 * 60 * 60
const pushTimeoutMs = 10_000

export type VapidKeys = { publicKey: string; privateKey: string; subject: string }

// The configured keys, or null when push is off (or misconfigured: config.ts stops a
// production start for that). The subject is how a push service reaches us about our
// pushes: VAPID_SUBJECT, else mailto:CONTACT_EMAIL, else the site's address.
export function vapidKeys(env: Record<string, string | undefined> = process.env): VapidKeys | null {
  const publicKey = env.VAPID_PUBLIC_KEY ?? ''
  const privateKey = env.VAPID_PRIVATE_KEY ?? ''
  if (!publicKey || !privateKey || vapidProblem(publicKey, privateKey)) {
    return null
  }
  const email = contact(env).email
  const subject = env.VAPID_SUBJECT || (email ? `mailto:${email}` : publicUrl(env))
  return { publicKey, privateKey, subject }
}

// Where pushes may go. The endpoint comes from the browser, so without this anyone could
// make the server POST to any address (an internal one, say). These are the push services
// of Chrome/Edge/Opera/Samsung (FCM), Firefox, Safari and Edge on Windows (WNS).
const pushServiceHosts = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
  '.push.apple.com',
  '.notify.windows.com',
]
let testOrigins: string[] = []

// For tests: also allow these origins (a fake push service on localhost, over http).
export function setTestPushOrigins(origins: string[]): void {
  testOrigins = origins
}

export function isPushEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (testOrigins.includes(url.origin)) {
    return true
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) {
    return false
  }
  return pushServiceHosts.some((host) =>
    host.startsWith('.') ? url.hostname.endsWith(host) : url.hostname === host,
  )
}

// One JWT per push service origin, reused for 12 hours of its 24 (the most RFC 8292 allows).
const tokens = new Map<string, { token: string; until: number }>()

async function vapidToken(keys: VapidKeys, audience: string): Promise<string> {
  const cached = tokens.get(audience)
  if (cached && cached.until > Date.now()) {
    return cached.token
  }
  const pub = Buffer.from(keys.publicKey, 'base64url')
  const key = await importJWK(
    {
      kty: 'EC',
      crv: 'P-256',
      x: pub.subarray(1, 33).toString('base64url'),
      y: pub.subarray(33).toString('base64url'),
      d: keys.privateKey,
    },
    'ES256',
  )
  const token = await new SignJWT({})
    .setProtectedHeader({ typ: 'JWT', alg: 'ES256' })
    .setAudience(audience)
    .setSubject(keys.subject)
    .setExpirationTime('24h')
    .sign(key)
  tokens.set(audience, { token, until: Date.now() + 12 * 60 * 60 * 1000 })
  return token
}

// Sends one empty push. A 404 or 410 means the browser dropped the subscription (the
// user turned notifications off, or reinstalled): it is deleted. Other failures are
// logged; the next notification tries again.
async function send(keys: VapidKeys, endpoint: string): Promise<void> {
  const audience = new URL(endpoint).origin
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${await vapidToken(keys, audience)}, k=${keys.publicKey}`,
      TTL: String(pushTtlSeconds),
      Urgency: 'normal',
      Topic: 'notifications',
      'Content-Length': '0',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(pushTimeoutMs),
  })
  await response.body?.cancel()
  if (response.status === 404 || response.status === 410) {
    await forgetPushEndpoint(endpoint)
    log('info', 'push subscription gone', { status: response.status })
  } else if (!response.ok) {
    log('warn', 'push refused', { status: response.status, service: audience })
  }
}

// Users with a push due later (the interval wasn't up), so it isn't scheduled twice.
const due = new Map<number, NodeJS.Timeout>()
const inFlight = new Set<Promise<void>>()
let registered = false

async function pushUser(keys: VapidKeys, userId: number, trailing: boolean): Promise<void> {
  // The push that follows a quiet interval only goes out if there is still something to
  // see: a browser must show a notification for every push, and an empty one is noise.
  if (trailing && (await countUnreadFromPrimary(userId)) === 0) {
    return
  }
  const { endpoints, waitSeconds } = await claimPushEndpoints(userId, pushIntervalSeconds)
  await Promise.all(
    endpoints.map((endpoint) =>
      send(keys, endpoint).catch((error: unknown) => {
        log('warn', 'push failed', { error: errorFields(error) })
      }),
    ),
  )
  if (waitSeconds !== null && !due.has(userId)) {
    const timer = setTimeout(
      () => {
        due.delete(userId)
        track(pushUser(keys, userId, true))
      },
      Math.max(0, waitSeconds * 1000) + 100,
    )
    timer.unref()
    due.set(userId, timer)
  }
}

function track(work: Promise<void>): void {
  const tracked = work.catch((error: unknown) => {
    log('error', 'push failed', { error: errorFields(error) })
  })
  inFlight.add(tracked)
  void tracked.finally(() => inFlight.delete(tracked))
}

// After a notification for each of `userIds` was saved: pushes to their devices, in the
// background (the request that saved it doesn't wait). Nothing when push is off.
export function pushNotifications(userIds: number[]): void {
  const keys = vapidKeys()
  if (!keys || userIds.length === 0) {
    return
  }
  if (!registered) {
    registered = true
    onCloseDb(async () => {
      registered = false
      for (const timer of due.values()) {
        clearTimeout(timer)
      }
      due.clear()
      await pushesSettled()
    })
  }
  for (const userId of new Set(userIds.map(Number))) {
    if (!due.has(userId)) {
      track(pushUser(keys, userId, false))
    }
  }
}

// Resolves once no push is being sent (tests; and closeDb, so shutdown lets them finish).
export async function pushesSettled(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.all(inFlight)
  }
}

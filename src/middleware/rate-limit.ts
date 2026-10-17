import { isIPv6 } from 'node:net'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { sendError } from '../negotiate.ts'

// Rate limits: one token bucket per limit and key (an IP, a user id, a username). A bucket
// holds up to `burst` tokens and refills steadily at `burst` per `periodSeconds`, so a
// burst is allowed and after that a steady rate. A request takes a token; an empty bucket
// is a 429 with Retry-After, the seconds until the next token.
//
// The counters live in this process's memory: no database round trip, no Redis. A restart
// forgets them, so everyone starts with a full bucket. That is fine for slowing down
// guessing and spam, but with several instances each keeps its own counts (see
// docs/routes.md, Rate limits).

export type Limit = { burst: number; periodSeconds: number }

// The defaults. Each one can be changed with RATE_LIMIT_<NAME>, e.g.
// RATE_LIMIT_LOGIN_IP=20/10m: a burst of 20, refilling 20 per 10 minutes (s, m, h).
const defaults = {
  // Argon2 is expensive on purpose: every attempt costs CPU, failed or not.
  loginIp: '10/10m',
  // Failed attempts only. Refills one a minute, so the owner waits a minute at worst.
  loginUsername: '5/5m',
  createUserIp: '5/1h',
  waitlistIp: '10/1h',
  blurt: '20/10m',
  follow: '60/10m',
  profileEdit: '30/10m',
  location: '30/10m',
  avatar: '60/10m',
  theme: '60/10m',
  timezone: '60/10m',
  report: '20/1h',
  deleteBlurt: '60/10m',
  mintInvites: '20/1h',
  // Reblurt and unreblurt share it. Quotes are blurts, under `blurt`.
  reblurt: '60/10m',
  // Like and unlike share it.
  like: '120/10m',
  // Checks the password with Argon2, like login.
  deleteAccount: '5/10m',
  // Per IP, logged in or not: a text search costs more than a feed page.
  search: '60/1m',
} satisfies Record<string, string>

export type LimitName = keyof typeof defaults

const units: Record<string, number> = { s: 1, m: 60, h: 3600 }

export function parseLimit(spec: string): Limit | undefined {
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*([smh])\s*$/.exec(spec)
  if (!match) {
    return undefined
  }
  const burst = Number(match[1])
  const periodSeconds = Number(match[2]) * units[match[3]]
  return burst > 0 && periodSeconds > 0 ? { burst, periodSeconds } : undefined
}

function envName(name: string): string {
  return `RATE_LIMIT_${name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`
}

function configuredLimit(name: LimitName): Limit {
  const variable = envName(name)
  const configured = process.env[variable]
  if (configured !== undefined) {
    const limit = parseLimit(configured)
    if (!limit) {
      throw new Error(`${variable} must look like 10/5m (a count, a slash, a period in s, m or h)`)
    }
    return limit
  }
  return parseLimit(defaults[name]) as Limit
}

const limits = Object.fromEntries(
  Object.keys(defaults).map((name) => [name, configuredLimit(name as LimitName)]),
) as Record<LimitName, Limit>

// Multiplies every burst (and so every rate). RATE_LIMIT_SCALE=100 for a load test (029),
// 0 to switch the limits off.
let scale = parseScale(process.env.RATE_LIMIT_SCALE)

function parseScale(value: string | undefined): number {
  if (value === undefined || value === '') {
    return 1
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('RATE_LIMIT_SCALE must be a number, 0 or more')
  }
  return parsed
}

// For tests: change the scale, and start every bucket full.
export function setRateLimitScale(value: number): void {
  scale = value
  buckets.clear()
}

export function resetRateLimits(): void {
  buckets.clear()
}

type Bucket = { tokens: number; updatedAt: number }

// Keyed by `${limit}:${key}`.
const buckets = new Map<string, Bucket>()

function capacity(limit: Limit): number {
  return limit.burst * scale
}

function refillPerMs(limit: Limit): number {
  return capacity(limit) / (limit.periodSeconds * 1000)
}

// The bucket as of now, refilled for the time since it was last touched.
function currentBucket(name: LimitName, key: string, now: number): Bucket {
  const limit = limits[name]
  const id = `${name}:${key}`
  let bucket = buckets.get(id)
  if (!bucket) {
    bucket = { tokens: capacity(limit), updatedAt: now }
    buckets.set(id, bucket)
  } else {
    bucket.tokens = Math.min(
      capacity(limit),
      bucket.tokens + (now - bucket.updatedAt) * refillPerMs(limit),
    )
    bucket.updatedAt = now
  }
  return bucket
}

export type Taken =
  | { allowed: true; refund: () => void }
  | { allowed: false; retryAfterSeconds: number }

// Takes a token from the bucket for `key` under limit `name`. `refund` puts it back, for a
// limit that should only count some outcomes (failed logins).
export function take(name: LimitName, key: string, now = Date.now()): Taken {
  if (scale === 0) {
    return { allowed: true, refund: () => {} }
  }
  const bucket = currentBucket(name, key, now)
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    return {
      allowed: true,
      refund: () => {
        const refunded = currentBucket(name, key, Date.now())
        refunded.tokens = Math.min(capacity(limits[name]), refunded.tokens + 1)
      },
    }
  }
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((1 - bucket.tokens) / refillPerMs(limits[name]) / 1000),
  )
  return { allowed: false, retryAfterSeconds }
}

export function sendTooManyRequests(
  request: Request,
  response: Response,
  retryAfterSeconds: number,
): void {
  response.set('Retry-After', String(retryAfterSeconds))
  const wait = retryAfterSeconds === 1 ? 'a second' : `${retryAfterSeconds} seconds`
  sendError(request, response, 429, `Too many requests. Please wait ${wait} and try again.`)
}

// The client's address, as Express sees it through `trust proxy`. IPv6 clients usually
// get a whole /64, so one is limited as a whole.
export function clientKey(request: Request): string {
  const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown'
  if (!isIPv6(ip) || ip.startsWith('::ffff:')) {
    return ip.replace(/^::ffff:/, '')
  }
  return `${expandIPv6(ip).slice(0, 4).join(':')}::/64`
}

function expandIPv6(ip: string): string[] {
  const [head, tail] = ip.split('%')[0].split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const missing = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill('0')
  return [...left, ...missing, ...right].map((group) => group.toLowerCase().replace(/^0+(?=.)/, ''))
}

// The logged-in user from requireAuth, which must run first.
export function accountKey(_request: Request, response: Response): string {
  return `user:${response.locals.authenticatedUser.id}`
}

// Middleware that takes a token under `name`, keyed by `key` (clientKey by default),
// and answers 429 when the bucket is empty. Reusable for any route:
//   router.post('/api/like', requireAuth, rateLimit('like', accountKey), ...)
export function rateLimit(
  name: LimitName,
  key: (request: Request, response: Response) => string = clientKey,
): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const taken = take(name, key(request, response))
    if (!taken.allowed) {
      sendTooManyRequests(request, response, taken.retryAfterSeconds)
      return
    }
    next()
  }
}

// Buckets that have refilled are the same as no bucket: drop them now and then, so memory
// stays bounded by the clients active in the last period.
function sweep(): void {
  const now = Date.now()
  for (const [id, bucket] of buckets) {
    const limit = limits[id.slice(0, id.indexOf(':')) as LimitName]
    if (bucket.tokens + (now - bucket.updatedAt) * refillPerMs(limit) >= capacity(limit)) {
      buckets.delete(id)
    }
  }
}
setInterval(sweep, 60_000).unref()

// `trust proxy` from TRUST_PROXY: unset or `false` when clients connect directly, a hop
// count (`1` behind one reverse proxy), or addresses/subnets Express accepts (`loopback`,
// `10.0.0.0/8`). Too generous a value lets clients pick their own IP with
// X-Forwarded-For, and so their own rate-limit bucket.
export function trustProxySetting(value = process.env.TRUST_PROXY): boolean | number | string {
  if (value === undefined || value === '' || value === 'false') {
    return false
  }
  if (value === 'true') {
    return true
  }
  return /^\d+$/.test(value) ? Number(value) : value
}

import type { Response } from 'express'
import pg from 'pg'
import { db, listenDatabaseUrl, onCloseDb } from './db.ts'
import { errorFields, log } from './logging.ts'
import { countUnreadFromPrimary } from './routes/state/notifications.ts'

// Live updates for pages with JavaScript on: GET /api/events (src/routes/events.ts) is a
// Server-Sent Events stream per open tab of a logged-in user, carrying
//
//   event: unread   {"unread": 3}       the unread notification count, at the start and
//                                       whenever it changes (new, read in another tab, gone)
//   event: blurts   [{"id": 12, "everyone": true, "following": false}, ...]
//                                       blurts posted since, for the feed's "N new blurts"
//                                       banner: whether each belongs at the top of the
//                                       everyone feed and of this user's following feed
//
// and a comment line every heartbeatMs, so proxies and the browser see the connection is
// alive. Nothing else is in them: the page fetches the blurts themselves when asked to.
//
// Fanout between app instances: the database tells every instance. Triggers on
// notifications and blurts NOTIFY the channel blurt_events (db/migrations, live events
// and push) when their transaction commits, whichever instance wrote, and each instance
// LISTENs on one connection of its own, straight to PostgreSQL (LISTEN_DATABASE_URL,
// src/db.ts: PgBouncer in transaction mode can't hold a LISTEN). That connection opens
// with the first stream, so a process that never serves one (tests, scripts) never opens it.
//
// Per instance it costs one socket per open tab, no database connection. A burst of
// messages is coalesced: unread counts are recounted at most once per user per
// unreadDelayMs, new blurts are sent in one batch per blurtBatchMs.

export const heartbeatMs = 25_000
// Open tabs per user and instance. More is refused with 429 (the browser's EventSource
// then stops; src/client/live.ts tries again much later), rather than closing an older
// tab, which would reconnect and close the next one, and so on.
export const maxStreamsPerUser = 5
const unreadDelayMs = 100
const blurtBatchMs = 1000
// How soon the browser reconnects after the stream ends (the SSE retry field).
const retryMs = 3000

type Stream = {
  userId: number
  response: Response
  unread: number | undefined
  timers: NodeJS.Timeout[]
}

const streams = new Map<number, Set<Stream>>()

// How long before closing a stream whose token runs out in `remainingMs`. A little jitter,
// so tabs opened together don't all reconnect together, but only ever earlier: up to a
// tenth of what is left, at most 10 s, never past the token's expiry.
export function closeDelay(remainingMs: number, random = Math.random()): number {
  const remaining = Math.max(0, remainingMs)
  return Math.floor(remaining - random * Math.min(10_000, remaining / 10))
}

export function streamCount(userId?: number): number {
  if (userId !== undefined) {
    return streams.get(userId)?.size ?? 0
  }
  let count = 0
  for (const set of streams.values()) {
    count += set.size
  }
  return count
}

function write(stream: Stream, event: string, data: unknown): void {
  stream.response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

// Starts the stream on `response`, which the route has checked is a logged-in user's
// with room for one more. It ends when the browser goes away, by `expiresAt` (ms since the
// epoch: when the access token it was opened with runs out; the browser then reconnects,
// refreshing its tokens on the way, so a logged-out or revoked session stops getting
// updates as soon as its pages would), or at closeEventStreams().
// Returns false when the user already has maxStreamsPerUser here.
export function openEventStream(userId: number, response: Response, expiresAt: number): boolean {
  const own = streams.get(userId) ?? new Set<Stream>()
  if (own.size >= maxStreamsPerUser) {
    return false
  }
  startListening()
  response.status(200)
  response.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    // no-transform: nothing on the way may compress or rewrite it (a compressing proxy
    // would hold events back to fill its buffers).
    'Cache-Control': 'no-store, no-transform',
    // nginx: pass every write through at once instead of buffering the response.
    'X-Accel-Buffering': 'no',
  })
  response.flushHeaders()
  // A comment first, so the browser sees the stream open even before the count is in.
  response.write(`retry: ${retryMs}\n: connected\n\n`)

  const stream: Stream = { userId, response, unread: undefined, timers: [] }
  own.add(stream)
  streams.set(userId, own)
  stream.timers.push(
    setInterval(() => response.write(': ping\n\n'), heartbeatMs),
    setTimeout(() => response.end(), closeDelay(expiresAt - Date.now())),
  )
  const done = () => {
    for (const timer of stream.timers) {
      clearTimeout(timer)
    }
    own.delete(stream)
    if (own.size === 0 && streams.get(userId) === own) {
      streams.delete(userId)
    }
  }
  response.on('close', done)
  response.on('error', done)

  void sendUnread(userId)
  return true
}

// Ends every stream, for a graceful shutdown: server.close() waits for open connections,
// and these never end by themselves. The browsers reconnect to another instance, or to
// this one once it is back.
export function closeEventStreams(): void {
  for (const set of streams.values()) {
    for (const stream of set) {
      stream.response.end()
    }
  }
}

// The unread count of a user, from the primary (the replica may not have the change yet),
// to each of their streams that doesn't have it yet.
async function sendUnread(userId: number): Promise<void> {
  if (!streams.has(userId)) {
    return
  }
  let unread: number
  try {
    unread = await countUnreadFromPrimary(userId)
  } catch (error) {
    log('error', 'live update failed', { error: errorFields(error) })
    return
  }
  for (const stream of streams.get(userId) ?? []) {
    if (stream.unread !== unread) {
      stream.unread = unread
      write(stream, 'unread', { unread })
    }
  }
}

const unreadDue = new Map<number, NodeJS.Timeout>()

function unreadChanged(userId: number): void {
  if (!streams.has(userId) || unreadDue.has(userId)) {
    return
  }
  unreadDue.set(
    userId,
    setTimeout(() => {
      unreadDue.delete(userId)
      void sendUnread(userId)
    }, unreadDelayMs),
  )
}

type Posted = { id: number; author: number; original: number | null }
let posted: Posted[] = []
let postedDue: NodeJS.Timeout | undefined

function blurtPosted(blurt: Posted): void {
  if (streams.size === 0) {
    return
  }
  posted.push(blurt)
  postedDue ??= setTimeout(() => {
    postedDue = undefined
    const batch = posted
    posted = []
    sendPosted(batch).catch((error: unknown) => {
      log('error', 'live update failed', { error: errorFields(error) })
    })
  }, blurtBatchMs)
}

// To every connected user but the author: the blurt (for a plain reblurt, the blurt it
// reblurts, which is what the feed shows) and which of their feeds it tops. The everyone
// feed has every top-level blurt and quote but no plain reblurts (src/routes/state/feeds.ts);
// the following feed has those and plain reblurts, from accounts they follow.
async function sendPosted(batch: Posted[]): Promise<void> {
  const users = [...streams.keys()]
  if (users.length === 0) {
    return
  }
  const { rows } = await db().query<{ userId: number; followedUserId: number }>(
    `SELECT user_id AS "userId", followed_user_id AS "followedUserId" FROM follows
     WHERE user_id = ANY($1::bigint[]) AND followed_user_id = ANY($2::bigint[])`,
    [users, [...new Set(batch.map((blurt) => blurt.author))]],
  )
  const follows = new Set(rows.map((row) => `${row.userId}:${row.followedUserId}`))
  for (const userId of users) {
    const items = batch
      .filter((blurt) => blurt.author !== userId)
      .map((blurt) => ({
        id: blurt.original ?? blurt.id,
        everyone: blurt.original === null,
        following: follows.has(`${userId}:${blurt.author}`),
      }))
      .filter((item) => item.everyone || item.following)
    if (items.length === 0) {
      continue
    }
    for (const stream of streams.get(userId) ?? []) {
      write(stream, 'blurts', items)
    }
  }
}

function received(payload: string | undefined): void {
  let message: { t?: unknown; u?: unknown; id?: unknown; o?: unknown }
  try {
    message = JSON.parse(payload ?? '')
  } catch {
    return
  }
  if (message.t === 'n' && typeof message.u === 'number') {
    unreadChanged(message.u)
  } else if (message.t === 'b' && typeof message.id === 'number' && typeof message.u === 'number') {
    blurtPosted({
      id: message.id,
      author: message.u,
      original: typeof message.o === 'number' ? message.o : null,
    })
  }
}

// The listening connection. If it drops (PostgreSQL restarted, network), it reconnects
// with a growing pause, and every stream gets its count again, since changes meanwhile
// were missed. Blurts posted meanwhile are missed: the banner is a hint, not a record.
let listener: pg.Client | undefined
let listening = false
let reconnectDue: NodeJS.Timeout | undefined
let failures = 0
const ready = new WeakSet<pg.Client>() // clients whose LISTEN is in place

function startListening(): void {
  if (listening) {
    return
  }
  listening = true
  onCloseDb(stopListening)
  void connect()
}

async function connect(): Promise<void> {
  const client = new pg.Client({ connectionString: listenDatabaseUrl(), keepAlive: true })
  listener = client
  client.on('notification', (message) => {
    if (message.channel === 'blurt_events') {
      received(message.payload)
    }
  })
  client.on('error', (error) => {
    log('error', 'live update listener failed', { error: errorFields(error) })
    lost(client)
  })
  client.on('end', () => lost(client))
  try {
    await client.connect()
    await client.query('LISTEN blurt_events')
    ready.add(client)
  } catch (error) {
    log('error', 'live update listener could not connect', { error: errorFields(error) })
    lost(client)
    return
  }
  if (failures > 0) {
    log('info', 'live update listener reconnected')
    for (const userId of streams.keys()) {
      for (const stream of streams.get(userId) ?? []) {
        stream.unread = undefined
      }
      unreadChanged(userId)
    }
  }
  failures = 0
}

function lost(client: pg.Client): void {
  if (listener !== client || !listening) {
    return
  }
  listener = undefined
  client.removeAllListeners('end')
  client.end().catch(() => {})
  failures += 1
  const delay = Math.min(30_000, 500 * 2 ** Math.min(failures, 6))
  reconnectDue = setTimeout(() => void connect(), delay)
}

async function stopListening(): Promise<void> {
  listening = false
  clearTimeout(reconnectDue)
  clearTimeout(postedDue)
  postedDue = undefined
  posted = []
  for (const timer of unreadDue.values()) {
    clearTimeout(timer)
  }
  unreadDue.clear()
  const client = listener
  listener = undefined
  failures = 0
  if (client) {
    client.removeAllListeners('end')
    await client.end().catch(() => {})
  }
}

// For tests: resolves once this instance is listening (a stream has been opened and the
// LISTEN is in place), so a NOTIFY sent after it can't be missed.
export async function listenerReady(timeoutMs = 5000): Promise<void> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (listener && ready.has(listener)) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('The live update listener did not start')
}

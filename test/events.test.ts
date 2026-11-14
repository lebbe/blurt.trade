import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import pg from 'pg'
import { app } from '../src/server.ts'
import { hkdfSync } from 'node:crypto'
import { decodeJwt, SignJWT } from 'jose'
import {
  closeDelay,
  closeEventStreams,
  listenerReady,
  maxStreamsPerUser,
  openEventStream,
  streamCount,
} from '../src/events.ts'
import { listenDatabaseUrl } from '../src/db.ts'
import { blurtIdByText, createSession, request, testMigrationDatabaseUrl } from './helpers.ts'

// GET /api/events: the live-update stream (src/events.ts), fed by NOTIFY from the database
// triggers, so it also carries what another app instance wrote.

type Stream = {
  status: number
  headers: http.IncomingHttpHeaders
  // Resolves with the next event called `name` (events already received count).
  next(name: string, timeoutMs?: number): Promise<unknown>
  raw(): string
  close(): void
}

let server: http.Server
let port = 0

test.before(async () => {
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  port = (server.address() as AddressInfo).port
})

test.after(async () => {
  closeEventStreams()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

function openStream(cookie: string): Promise<Stream> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { port, path: '/api/events', headers: { cookie, accept: 'text/event-stream' } },
      (response) => {
        let text = ''
        const events: { name: string; data: unknown }[] = []
        const waiters: (() => void)[] = []
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          text += chunk
          let end: number
          while ((end = text.indexOf('\n\n')) !== -1) {
            const block = text.slice(0, end)
            text = text.slice(end + 2)
            all += `${block}\n\n`
            const name = /^event: (.*)$/m.exec(block)?.[1]
            const data = /^data: (.*)$/m.exec(block)?.[1]
            if (name && data !== undefined) {
              events.push({ name, data: JSON.parse(data) })
              for (const wake of waiters.splice(0)) {
                wake()
              }
            }
          }
        })
        let all = ''
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          raw: () => all,
          close: () => req.destroy(),
          next: async (name, timeoutMs = 4000) => {
            const until = Date.now() + timeoutMs
            for (;;) {
              const index = events.findIndex((event) => event.name === name)
              if (index !== -1) {
                return events.splice(index, 1)[0].data
              }
              if (Date.now() > until) {
                throw new Error(`No "${name}" event; got: ${all}`)
              }
              await new Promise<void>((wake) => {
                waiters.push(wake)
                setTimeout(wake, 50)
              })
            }
          },
        })
      },
    )
    req.on('error', reject)
  })
}

test('the stream is for logged-in users only, with headers that keep proxies from holding it', async () => {
  const anonymous = await request('GET', '/api/events', '', { accept: 'text/event-stream' })
  assert.equal(anonymous.statusCode, 401)

  const lars = await createSession('Lars')
  const stream = await openStream(lars)
  try {
    assert.equal(stream.status, 200)
    assert.equal(stream.headers['content-type'], 'text/event-stream; charset=utf-8')
    assert.equal(stream.headers['cache-control'], 'no-store, no-transform')
    assert.equal(stream.headers['x-accel-buffering'], 'no')
    assert.equal(stream.headers['content-encoding'], undefined)
    assert.deepEqual(await stream.next('unread'), { unread: 0 })
    assert.match(stream.raw(), /^retry: \d+\n: connected\n\n/)
  } finally {
    stream.close()
  }
})

test('the unread count follows replies, reblurts and reading, live', async () => {
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=first', { cookie: lars })
  const id = await blurtIdByText('first')
  const stream = await openStream(lars)
  try {
    assert.deepEqual(await stream.next('unread'), { unread: 0 })
    await listenerReady()
    await request('POST', '/api/blurts', `text=a reply&parentId=${id}`, { cookie: ada })
    assert.deepEqual(await stream.next('unread'), { unread: 1 })
    await request('POST', '/api/reblurt', `blurtId=${id}`, { cookie: ada })
    assert.deepEqual(await stream.next('unread'), { unread: 2 })
    // Read in another tab: this one hears of it too.
    await request('POST', '/api/notifications/read', '', { cookie: lars })
    assert.deepEqual(await stream.next('unread'), { unread: 0 })
  } finally {
    stream.close()
  }
})

test('a NOTIFY from anywhere reaches the stream: what another instance wrote', async () => {
  const lars = await createSession('Lars')
  await createSession('Ada')
  await request('POST', '/api/blurts', 'text=hello', { cookie: lars })
  const id = await blurtIdByText('hello')
  const stream = await openStream(lars)
  // Another "instance": its own connection, writing straight to PostgreSQL.
  const other = new pg.Client({ connectionString: testMigrationDatabaseUrl })
  await other.connect()
  try {
    assert.deepEqual(await stream.next('unread'), { unread: 0 })
    await listenerReady()
    await other.query(
      `INSERT INTO notifications (user_id, kind, actor_user_id, blurt_id)
       SELECT l.id, 'reblurt', a.id, $1 FROM users l, users a
       WHERE l.username = 'Lars' AND a.username = 'Ada'`,
      [id],
    )
    assert.deepEqual(await stream.next('unread'), { unread: 1 })
  } finally {
    await other.end()
    stream.close()
  }
})

test('new blurts are announced to others, marked with the feeds they top', async () => {
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  const bo = await createSession('Bo')
  await request('POST', '/api/follow', 'username=Ada', { cookie: lars })
  const larsStream = await openStream(lars)
  const adaStream = await openStream(ada)
  try {
    await larsStream.next('unread')
    await adaStream.next('unread')
    await listenerReady()
    // Blurts from earlier tests may still be in the batch (src/events.ts): let it go out.
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await larsStream.next('blurts', 0).catch(() => {})
    await adaStream.next('blurts', 0).catch(() => {})
    await request('POST', '/api/blurts', 'text=from ada', { cookie: ada })
    const adaId = await blurtIdByText('from ada')
    assert.deepEqual(await larsStream.next('blurts'), [
      { id: adaId, everyone: true, following: true },
    ])
    await request('POST', '/api/blurts', 'text=from bo', { cookie: bo })
    const boId = await blurtIdByText('from bo')
    assert.deepEqual(await larsStream.next('blurts'), [
      { id: boId, everyone: true, following: false },
    ])
    // Ada heard of Bo's, not her own.
    assert.deepEqual(await adaStream.next('blurts'), [
      { id: boId, everyone: true, following: false },
    ])
    // Replies are no feed's news.
    await request('POST', '/api/blurts', `text=a reply&parentId=${boId}`, { cookie: ada })
    // A plain reblurt by someone Lars follows: the original, for the following feed only.
    await request('POST', '/api/reblurt', `blurtId=${boId}`, { cookie: ada })
    assert.deepEqual(await larsStream.next('blurts'), [
      { id: boId, everyone: false, following: true },
    ])
    await assert.rejects(adaStream.next('blurts', 1500))
  } finally {
    larsStream.close()
    adaStream.close()
  }
})

test(`at most ${maxStreamsPerUser} streams per user, and closed streams are let go`, async () => {
  const lars = await createSession('Lars')
  const streams = await Promise.all(
    Array.from({ length: maxStreamsPerUser }, () => openStream(lars)),
  )
  try {
    for (const stream of streams) {
      assert.equal(stream.status, 200)
    }
    const refused = await request('GET', '/api/events', '', {
      cookie: lars,
      accept: 'text/event-stream',
    })
    assert.equal(refused.statusCode, 429)
  } finally {
    for (const stream of streams) {
      stream.close()
    }
  }
  const until = Date.now() + 2000
  while (streamCount() > 0 && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(streamCount(), 0)
  const again = await openStream(lars)
  assert.equal(again.status, 200)
  again.close()
})

test('closeEventStreams ends every stream, so a shutdown is not held up', async () => {
  const lars = await createSession('Lars')
  const stream = await openStream(lars)
  await stream.next('unread')
  const ended = new Promise<void>((resolve) => {
    // The response ends from the server side.
    const check = setInterval(() => {
      if (streamCount() === 0) {
        clearInterval(check)
        resolve()
      }
    }, 10)
  })
  closeEventStreams()
  await ended
  stream.close()
})

test('the listener connects straight to PostgreSQL, not through PgBouncer', () => {
  assert.equal(listenDatabaseUrl(), testMigrationDatabaseUrl)
  assert.equal(
    listenDatabaseUrl({ MIGRATION_DATABASE_URL: 'postgres://m', DATABASE_URL: 'postgres://d' }),
    'postgres://m',
  )
  assert.equal(
    listenDatabaseUrl({
      LISTEN_DATABASE_URL: 'postgres://l',
      MIGRATION_DATABASE_URL: 'postgres://m',
    }),
    'postgres://l',
  )
})

test('a stream ends when the access token it was opened with runs out, not a lifetime later', async () => {
  const lars = await createSession('Lars')
  // An access token for the same session that runs out in two seconds, signed with the
  // same key the app derives (src/middleware/auth.ts) from the development secret.
  const token = lars.slice(lars.indexOf('=') + 1)
  const claims = decodeJwt(token)
  const key = new Uint8Array(
    hkdfSync('sha256', 'development-only-secret', 'blurt.trade', 'access token', 32),
  )
  const expiring = await new SignJWT({ ...claims, exp: Math.floor(Date.now() / 1000) + 2 })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(key)
  const stream = await openStream(`${lars.slice(0, lars.indexOf('='))}=${expiring}`)
  assert.equal(stream.status, 200)
  await stream.next('unread')
  const until = Date.now() + 4000
  while (streamCount() > 0 && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  stream.close()
  assert.equal(streamCount(), 0, 'the stream outlived its access token')
})

test('the close is jittered only ever earlier, never past the token', () => {
  assert.equal(closeDelay(300_000, 0), 300_000)
  assert.equal(closeDelay(300_000, 1), 290_000)
  assert.equal(closeDelay(2000, 1), 1800)
  assert.equal(closeDelay(-5, 0.5), 0)
})

test('a request the browser gave up on before the stream opened is not kept', async () => {
  // As when the page navigates away while the route is still checking the login.
  const gone = express()
  gone.get('/', (request, response) => {
    request.on('close', () => {
      assert.equal(openEventStream(4242, response, Date.now() + 60_000), true)
      opened()
    })
  })
  let opened!: () => void
  const done = new Promise<void>((resolve) => {
    opened = resolve
  })
  const server = gone.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const req = http.get({ port: (server.address() as AddressInfo).port, path: '/' })
  req.on('error', () => {})
  setTimeout(() => req.destroy(), 50)
  await done
  assert.equal(streamCount(4242), 0)
  await new Promise((resolve) => server.close(resolve))
})

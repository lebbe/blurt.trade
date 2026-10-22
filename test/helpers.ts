import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { migrate } from '../db/migrate.ts'
import { closeDb, db } from '../src/db.ts'
import { embedPendingBlurts, setEmbedder } from '../src/embeddings.ts'
import { closePicturePool } from '../src/picture-pool.ts'
import { app } from '../src/server.ts'
import {
  resetRateLimits,
  setRateLimitScale,
  trustProxySetting,
} from '../src/middleware/rate-limit.ts'
import { setLogSink } from '../src/logging.ts'

export const stylesheet = readFileSync(
  join(import.meta.dirname, '..', 'public', 'style.css'),
  'utf8',
)

// Never the dev database: every test wipes all tables. Like the app, queries go through
// PgBouncer (6433) and migrations straight to PostgreSQL (5433).
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://blurt:blurt@localhost:6433/blurt_test'
export const testMigrationDatabaseUrl =
  process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://blurt:blurt@localhost:5433/blurt_test'

export function request(
  method: string,
  path: string,
  body: string | Buffer = '',
  headers: Record<string, string> = {},
): Promise<{
  statusCode: number
  contentType?: string
  location?: string
  setCookie?: string[]
  retryAfter?: string
  headers: http.IncomingHttpHeaders
  body: string
  bodyBytes: Buffer
}> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Could not determine test server address'))
        return
      }

      const request = http.request(
        {
          method,
          port: address.port,
          path,
          headers: {
            ...(body
              ? {
                  'content-type': 'application/x-www-form-urlencoded',
                  'content-length': Buffer.byteLength(body),
                }
              : {}),
            ...headers,
          },
        },
        (response: http.IncomingMessage) => {
          const responseChunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => responseChunks.push(chunk))
          response.on('end', () => {
            server.close()
            const bodyBytes = Buffer.concat(responseChunks)
            resolve({
              statusCode: response.statusCode ?? 0,
              contentType: response.headers['content-type'],
              location: response.headers.location,
              setCookie: response.headers['set-cookie'],
              retryAfter: response.headers['retry-after'],
              headers: response.headers,
              body: bodyBytes.toString(),
              bodyBytes,
            })
          })
        },
      )
      request.on('error', reject)
      request.end(body)
    })
  })
}

// One dimension per topic word, so "related" is predictable without loading the real model.
setEmbedder(async (texts) =>
  texts.map((text) => {
    const vector = Array<number>(384).fill(0)
    const topic = ['cat', 'stock'].findIndex((word) => text.includes(word))
    vector[topic === -1 ? 2 : topic] = 1
    return vector
  }),
)

test.before(() => migrate(testMigrationDatabaseUrl))

// Request logs would clutter the test output; tests that check them collect them.
setLogSink(() => {})

export function collectLogs(t: {
  after: (callback: () => void) => void
}): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = []
  setLogSink((_level, line) => lines.push(JSON.parse(line)))
  t.after(() => setLogSink(() => {}))
  return lines
}

// Many tests sign up more users from one address than the real limits allow; the rate
// limit tests below switch back to the real limits.
setRateLimitScale(1000)

test.beforeEach(async () => {
  resetRateLimits()
  await db().query(
    'TRUNCATE users, user_profiles, blurts, waitlist, invite_codes, retired_usernames RESTART IDENTITY CASCADE',
  )
  await setSignupLimits(1000, 10000)
})

// Also resets the count, so the limits apply from zero sign-ups.
export async function setSignupLimits(softLimit: number, hardLimit: number): Promise<void> {
  await db().query(
    'UPDATE signup_counter SET current_count = 0, soft_limit = $1, hard_limit = $2',
    [softLimit, hardLimit],
  )
}

export async function signupCount(): Promise<number> {
  const { rows } = await db().query('SELECT current_count FROM signup_counter')
  return rows[0].current_count
}

test.after(async () => {
  await closePicturePool()
  await embedPendingBlurts()
  await closeDb()
})

export async function countBlurts(): Promise<number> {
  const { rows } = await db().query('SELECT count(*)::int AS count FROM blurts')
  return rows[0].count
}

export async function insertBlurt(username: string, text: string, createdAt: Date): Promise<void> {
  await db().query(
    'INSERT INTO blurts (user_id, text, created_at) SELECT id, $2, $3 FROM users WHERE username = $1',
    [username, text, createdAt],
  )
}

export async function createSession(username = 'Lars'): Promise<string> {
  const response = await request(
    'POST',
    '/signup',
    `username=${encodeURIComponent(username)}&password=correct-horse`,
  )
  assert.equal(response.statusCode, 303)
  return response.setCookie?.[0]?.split(';', 1)[0] ?? ''
}

export async function blurtIdByText(text: string): Promise<number> {
  const { rows } = await db().query('SELECT id FROM blurts WHERE text = $1', [text])
  return rows[0].id
}

export const json = { accept: 'application/json' }

export function sendJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  return request('POST', path, JSON.stringify(body), {
    ...json,
    'content-type': 'application/json',
    ...headers,
  })
}

// `count` blurts by Lars, `blurt 1` oldest. Every `tie` of them share one created_at, with
// microseconds a JS Date can't hold, so page boundaries fall inside a group of equal times.
export async function insertBlurts(
  count: number,
  parentId: number | null = null,
  tie = 7,
): Promise<void> {
  await db().query(
    `INSERT INTO blurts (user_id, text, parent_id, created_at)
     SELECT u.id, 'blurt ' || i, $2,
       timestamptz '2026-10-10 12:00:00.123456+00' + ((i - 1) / $3) * interval '1 second'
     FROM users u, generate_series(1, $1) AS i WHERE u.username = 'Lars' ORDER BY i`,
    [count, parentId, tie],
  )
}

// Users without profiles or real passwords, each with one top-level blurt and one reply to
// it, for feed tests that don't need to log them in.
export async function insertFollowees(count: number): Promise<void> {
  await db().query(
    `WITH new_users AS (
       INSERT INTO users (username, password_hash)
       SELECT 'user' || i, 'x' FROM generate_series(1, $1) AS i RETURNING id, username
     ), top_level AS (
       INSERT INTO blurts (user_id, text) SELECT id, 'top from ' || username FROM new_users
       RETURNING id, user_id
     )
     INSERT INTO blurts (user_id, text, parent_id) SELECT user_id, 'reply', id FROM top_level`,
    [count],
  )
}

// `username` follows user1 to user<count>.
export async function followFirst(username: string, count: number): Promise<void> {
  await db().query(
    `INSERT INTO follows (user_id, followed_user_id)
     SELECT f.id, u.id FROM users f, users u, generate_series(1, $2) AS i
     WHERE f.username = $1 AND u.username = 'user' || i`,
    [username, count],
  )
}

export async function likeCount(id: number): Promise<number> {
  return (await stats(id)).like_count
}

// A blurt's counters; no blurt_stats row means zero.
export async function stats(id: number): Promise<{ like_count: number; reblurt_count: number }> {
  const { rows } = await db().query(
    'SELECT like_count, reblurt_count FROM blurt_stats WHERE blurt_id = $1',
    [id],
  )
  return rows[0] ?? { like_count: 0, reblurt_count: 0 }
}

// Puts the user's profile location straight in the database (already a cell centre).
export async function placeAt(username: string, lat: number, lon: number): Promise<void> {
  await db().query(
    `UPDATE user_profiles p SET location = ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography
     FROM users u WHERE u.id = p.user_id AND u.username = $1`,
    [username, lat, lon],
  )
}

// The cookies a response sets, by name. A cleared cookie is ''.
export function cookiesSet(response: { setCookie?: string[] }): Record<string, string> {
  return Object.fromEntries(
    (response.setCookie ?? []).map((cookie) => {
      const [pair] = cookie.split(';', 1)
      const at = pair.indexOf('=')
      return [pair.slice(0, at), pair.slice(at + 1)]
    }),
  )
}

export async function signUp(username = 'Lars'): Promise<Record<string, string>> {
  const response = await request('POST', '/signup', `username=${username}&password=correct-horse`)
  assert.equal(response.statusCode, 303)
  return cookiesSet(response)
}

// The feed as JSON with only the refresh token: what a browser sends once it has dropped
// the expired access token.
export function feedWithRefreshToken(refreshToken: string) {
  return request('GET', '/', '', { ...json, cookie: `refresh_token=${refreshToken}` })
}

export function viewerName(response: { body: string }): string | null {
  return JSON.parse(response.body).viewer?.username ?? null
}

// The codes listed on the user's own profile, unused first.
export async function inviteCodes(
  username: string,
  cookie: string,
): Promise<{ code: string; usedBy: string | null }[]> {
  const response = await request('GET', `/${username}/`, '', { ...json, cookie })
  return JSON.parse(response.body).inviteCodes
}

// The real limits, and request.ip from X-Forwarded-For so each test can be its own client.
export async function withRealRateLimits(run: () => Promise<void>): Promise<void> {
  setRateLimitScale(1)
  app.set('trust proxy', 'loopback')
  try {
    await run()
  } finally {
    app.set('trust proxy', trustProxySetting())
    setRateLimitScale(1000)
  }
}

export function from(ip: string, headers: Record<string, string> = {}): Record<string, string> {
  return { 'x-forwarded-for': ip, ...headers }
}

export async function blurtRow(id: number): Promise<Record<string, unknown> | undefined> {
  const { rows } = await db().query(
    'SELECT user_id, text, embedding, deleted_at IS NOT NULL AS deleted FROM blurts WHERE id = $1',
    [id],
  )
  return rows[0]
}

export async function search(query: string, headers: Record<string, string> = json) {
  return request('GET', `/search${query}`, '', headers)
}

// A multipart/form-data body, as a browser sends a form with a file field.
export function multipart(
  fields: Record<string, string>,
  file?: { name: string; filename: string; type: string; content: Buffer },
): { body: Buffer; headers: Record<string, string> } {
  const boundary = '----blurt-test-boundary'
  const parts: Buffer[] = Object.entries(fields).map(([name, value]) =>
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ),
  )
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
      file.content,
      Buffer.from('\r\n'),
    )
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return {
    body: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

// A PNG of a red rectangle on blue.
export function samplePng(width = 800, height = 400): Buffer {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#2f6fdb'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#d4001c'
  context.fillRect(width / 4, height / 4, width / 2, height / 2)
  return canvas.toBuffer('image/png')
}

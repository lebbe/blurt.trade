import test from 'node:test'
import assert from 'node:assert/strict'
import { closeDb, db, dbRead, poolSize } from '../src/db.ts'
import { embedPendingBlurts } from '../src/embeddings.ts'
import { recentWriteCookie } from '../src/middleware/replica.ts'
import { blurtIdByText, cookiesSet, createSession, insertBlurt, json, request } from './helpers.ts'

test('transactions work through PgBouncer with more callers than connections', async () => {
  // PgBouncer's default_pool_size in db/setup-wsl.sh. A bigger app pool would queue in it.
  assert.ok(poolSize <= 20)
  const results = await Promise.all(
    Array.from({ length: poolSize * 3 }, async (_, index) => {
      const client = await db().connect()
      try {
        await client.query('BEGIN')
        await client.query('SELECT pg_sleep(0.01)')
        const { rows } = await client.query<{ value: number }>('SELECT $1::int AS value', [index])
        await client.query('COMMIT')
        return rows[0].value
      } finally {
        client.release()
      }
    }),
  )
  assert.deepEqual(
    results,
    Array.from({ length: poolSize * 3 }, (_, index) => index),
  )
})

// Points dbRead() at a pool of its own and returns the SQL of every query sent through it.
// The pool goes to `url`, by default the test database itself, so there is no replica lag
// and the test only checks which queries take the read path.
function useReadPool(
  t: { after: (callback: () => Promise<void>) => void },
  url = process.env.DATABASE_URL,
): string[] {
  process.env.DATABASE_READ_URL = url
  t.after(async () => {
    delete process.env.DATABASE_READ_URL
    await closeDb()
  })
  const pool = dbRead()
  assert.notEqual(pool, db())
  const queries: string[] = []
  const query = pool.query.bind(pool)
  pool.query = ((...args: Parameters<typeof query>) => {
    queries.push(String(typeof args[0] === 'string' ? args[0] : args[0]?.text))
    return query(...args)
  }) as typeof pool.query
  return queries
}

test('feed, related blurts and discovery read from the replica when one is configured', async (t) => {
  const cookie = await createSession('Lars')
  await createSession('Ada')
  await insertBlurt('Ada', 'cat videos all day', new Date())
  await request('POST', '/api/blurts', 'text=my+cat+is+great', { cookie })
  await embedPendingBlurts()
  const id = await blurtIdByText('my cat is great')
  const replica = useReadPool(t)

  const home = JSON.parse((await request('GET', '/', '', { ...json, cookie })).body)
  assert.equal(home.blurts.length, 2)
  assert.ok(
    replica.some((sql) => /ORDER BY r\.created_at DESC/.test(sql)),
    'feed',
  )
  assert.ok(
    replica.some((sql) => /unnest/.test(sql)),
    'feed replies',
  )
  assert.ok(
    replica.some((sql) => /WITH taste/.test(sql)),
    'you might like',
  )
  assert.ok(
    replica.some((sql) => /ST_DWithin/.test(sql)),
    'near you',
  )

  replica.length = 0
  const page = await request('GET', `/Lars/${id}`)
  assert.match(page.body.slice(page.body.indexOf('Related blurts')), /cat videos all day/)
  assert.ok(
    replica.some((sql) => /WITH target/.test(sql)),
    'related blurts',
  )
})

test('a write, and reads for a moment after it, go to the primary', async (t) => {
  const cookie = await createSession('Lars')
  const replica = useReadPool(t)

  // The POST sets the cookie, and the form error page it renders reads from the primary.
  const posted = await request('POST', '/api/blurts', 'text=', { cookie })
  assert.equal(posted.statusCode, 400)
  assert.deepEqual(replica, [])
  const recent = cookiesSet(posted)[recentWriteCookie]
  assert.equal(recent, '1')
  assert.match(
    posted.setCookie?.find((line) => line.startsWith(`${recentWriteCookie}=`)) ?? '',
    /Max-Age=10; Path=\/; .*HttpOnly; SameSite=Lax/,
  )

  // The redirect after posting carries the cookie: the feed comes from the primary.
  await request('POST', '/api/blurts', 'text=Hello+world', { cookie })
  const feed = await request('GET', '/', '', { cookie: `${cookie}; ${recentWriteCookie}=1` })
  assert.match(feed.body, /Hello world/)
  assert.deepEqual(replica, [])

  // Without it (another browser, or later on), the replica again.
  await request('GET', '/', '', { cookie })
  assert.ok(replica.length > 0)
})

// The real streaming replica from db/setup-wsl.sh, behind PgBouncer: it lags, so this is
// the end-to-end check that posters see their own blurt straight after the redirect.
test('the poster sees their new blurt at once with a real streaming replica', async (t) => {
  const cookie = await createSession('Lars')
  const replica = useReadPool(
    t,
    process.env.TEST_DATABASE_READ_URL ?? 'postgres://blurt:blurt@localhost:6433/blurt_test_read',
  )
  const { rows } = await dbRead().query('SELECT pg_is_in_recovery() AS standby')
  assert.equal(rows[0].standby, true)

  for (const n of [1, 2, 3]) {
    const text = `fresh blurt ${n}`
    const posted = await request('POST', '/api/blurts', `text=${encodeURIComponent(text)}`, {
      cookie,
    })
    assert.equal(posted.statusCode, 303)
    const recent = `${recentWriteCookie}=${cookiesSet(posted)[recentWriteCookie]}`
    const feed = await request('GET', posted.location ?? '', '', { cookie: `${cookie}; ${recent}` })
    assert.match(feed.body, new RegExp(text))
  }

  // Everyone else reads the replica, which catches up.
  replica.length = 0
  let feed = ''
  for (let tries = 0; tries < 50 && !feed.includes('fresh blurt 3'); tries++) {
    feed = (await request('GET', '/')).body
  }
  assert.match(feed, /fresh blurt 3/)
  assert.ok(replica.length > 0)
})

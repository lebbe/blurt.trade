import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db.ts'
import { recentWriteCookie } from '../src/middleware/replica.ts'
import {
  cookiesSet,
  countBlurts,
  feedWithRefreshToken,
  json,
  request,
  signUp,
  viewerName,
} from './helpers.ts'

async function sessionRows(): Promise<
  { generation: number; revoked: boolean; persistent: boolean }[]
> {
  const { rows } = await db().query(
    `SELECT current_generation AS generation, revoked_at IS NOT NULL AS revoked, persistent
     FROM sessions ORDER BY created_at`,
  )
  return rows
}

test('ticking "Keep me logged in" sets a short access token and a 400-day refresh token, both HttpOnly', async () => {
  const response = await request(
    'POST',
    '/createUser',
    'username=Lars&password=correct-horse&remember=1',
  )

  const [access, refresh] = response.setCookie ?? []
  assert.match(access, /^access_token=.+; Max-Age=300;.*HttpOnly.*SameSite=Lax/i)
  assert.match(refresh, /^refresh_token=.+; Max-Age=34560000;.*Path=\/;.*HttpOnly.*SameSite=Lax/i)
  assert.deepEqual(await sessionRows(), [{ generation: 0, revoked: false, persistent: true }])
})

test('stays logged in after the access token expires, rotating the refresh token', async (t) => {
  const cookies = await signUp()
  const cookie = `access_token=${cookies.access_token}; refresh_token=${cookies.refresh_token}`

  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 6 * 60 * 1000 })
  const later = await request('GET', '/', '', { ...json, cookie })
  t.mock.timers.reset()

  assert.equal(viewerName(later), 'Lars')
  const rotated = cookiesSet(later)
  assert.ok(rotated.access_token)
  assert.ok(rotated.refresh_token)
  assert.notEqual(rotated.refresh_token, cookies.refresh_token)
  assert.deepEqual(await sessionRows(), [{ generation: 1, revoked: false, persistent: false }])

  // Form POSTs refresh the same way, without JS.
  const post = await request('POST', '/api/blurts', 'text=Still+here', {
    cookie: `refresh_token=${rotated.refresh_token}`,
  })
  assert.equal(post.statusCode, 303)
  assert.equal(await countBlurts(), 1)
  assert.deepEqual(await sessionRows(), [{ generation: 2, revoked: false, persistent: false }])
})

test('replaying an old refresh token revokes the session for everyone holding it', async () => {
  const stolen = (await signUp()).refresh_token
  const rotated = await feedWithRefreshToken(stolen)
  assert.equal(viewerName(rotated), 'Lars')
  const current = cookiesSet(rotated)
  // Past the window in which a second tab may still present the previous token.
  await db().query(`UPDATE sessions SET last_used_at = now() - interval '1 minute'`)

  const replay = await feedWithRefreshToken(stolen)

  assert.equal(viewerName(replay), null)
  assert.equal(cookiesSet(replay).refresh_token, '')
  assert.deepEqual(await sessionRows(), [{ generation: 1, revoked: true, persistent: false }])
  // The current token is dead too: there's no telling which copy was the thief's.
  assert.equal(viewerName(await feedWithRefreshToken(current.refresh_token)), null)
  // An access token already handed out lasts until it expires (5 minutes). That's the price
  // of not touching the database on every request.
  const access = await request('GET', '/', '', {
    ...json,
    cookie: `access_token=${current.access_token}`,
  })
  assert.equal(viewerName(access), 'Lars')
})

test('two tabs refreshing with the same token at once both stay logged in', async () => {
  const shared = (await signUp()).refresh_token

  const tabs = await Promise.all([feedWithRefreshToken(shared), feedWithRefreshToken(shared)])

  assert.deepEqual(tabs.map(viewerName), ['Lars', 'Lars'])
  const issued = tabs.map(cookiesSet)
  assert.ok(issued.every((cookies) => cookies.access_token))
  // Only the tab that won the race gets the next refresh token. The browser shares it.
  const refreshTokens = issued.map((cookies) => cookies.refresh_token).filter(Boolean)
  assert.equal(refreshTokens.length, 1)
  assert.deepEqual(await sessionRows(), [{ generation: 1, revoked: false, persistent: false }])

  // A third tab a moment later is still within the window.
  assert.equal(viewerName(await feedWithRefreshToken(shared)), 'Lars')
  assert.equal(viewerName(await feedWithRefreshToken(refreshTokens[0])), 'Lars')
  assert.deepEqual(await sessionRows(), [{ generation: 2, revoked: false, persistent: false }])
})

test('a refresh token two generations old is a replay, even right away', async () => {
  const first = (await signUp()).refresh_token
  const second = cookiesSet(await feedWithRefreshToken(first)).refresh_token
  await feedWithRefreshToken(second)

  assert.equal(viewerName(await feedWithRefreshToken(first)), null)
  assert.deepEqual(await sessionRows(), [{ generation: 2, revoked: true, persistent: false }])
})

test('rejects forged, swapped and idle refresh tokens', async () => {
  const cookies = await signUp()
  const [header, payload, signature] = cookies.refresh_token.split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
  const forged = Buffer.from(JSON.stringify({ ...claims, gen: 5 })).toString('base64url')

  for (const token of [
    `${header}.${forged}.${signature}`,
    cookies.access_token, // signed with the access key, so never a refresh token
    encodeURIComponent('j:{"sid":1}'), // cookie-parser turns this into an object
    'garbage',
  ]) {
    const response = await feedWithRefreshToken(token)
    assert.equal(viewerName(response), null, token)
    assert.equal(cookiesSet(response).refresh_token, '', token)
  }
  assert.deepEqual(await sessionRows(), [{ generation: 0, revoked: false, persistent: false }])

  await db().query(`UPDATE sessions SET last_used_at = now() - interval '401 days'`)
  assert.equal(viewerName(await feedWithRefreshToken(cookies.refresh_token)), null)
})

test('logging out revokes the session, and logging in again starts a new one', async () => {
  const cookies = await signUp()

  const logout = await request('POST', '/api/logout', '', {
    cookie: `access_token=${cookies.access_token}; refresh_token=${cookies.refresh_token}`,
  })

  assert.equal(logout.statusCode, 303)
  assert.deepEqual(cookiesSet(logout), {
    access_token: '',
    refresh_token: '',
    [recentWriteCookie]: '1',
  })
  assert.equal(viewerName(await feedWithRefreshToken(cookies.refresh_token)), null)

  const login = await request('POST', '/login', 'username=Lars&password=correct-horse')
  assert.equal(viewerName(await feedWithRefreshToken(cookiesSet(login).refresh_token)), 'Lars')
  assert.deepEqual(await sessionRows(), [
    { generation: 0, revoked: true },
    { generation: 1, revoked: false },
  ])
})

test('logs out every browser and device from settings', async () => {
  const laptop = await signUp()
  const phone = cookiesSet(await request('POST', '/login', 'username=Lars&password=correct-horse'))
  await signUp('Ada')
  const laptopCookie = `access_token=${laptop.access_token}`

  assert.equal((await request('GET', '/settings', '', json)).statusCode, 401)
  const settings = await request('GET', '/settings', '', { ...json, cookie: laptopCookie })
  assert.deepEqual(JSON.parse(settings.body), {
    viewer: { id: 1, username: 'Lars' },
    activeSessions: 2,
  })
  const page = await request('GET', '/settings', '', { cookie: laptopCookie })
  assert.match(page.body, /logged in on 2 browsers or devices/)
  assert.match(page.body, /action="\/api\/logout-everywhere"/)

  const response = await request('POST', '/api/logout-everywhere', '', { cookie: laptopCookie })

  assert.equal(response.statusCode, 303)
  assert.equal(response.location, '/login')
  assert.deepEqual(cookiesSet(response), {
    access_token: '',
    refresh_token: '',
    [recentWriteCookie]: '1',
  })
  assert.equal(viewerName(await feedWithRefreshToken(laptop.refresh_token)), null)
  assert.equal(viewerName(await feedWithRefreshToken(phone.refresh_token)), null)
  // Ada is still logged in.
  assert.deepEqual(
    (await sessionRows()).map((row) => row.revoked),
    [true, true, false],
  )
})

test('without "Keep me logged in" the refresh cookie is a browser-session cookie', async () => {
  for (const [path, body] of [
    ['/createUser', 'username=Lars&password=correct-horse'],
    ['/login', 'username=Lars&password=correct-horse&remember=0'],
  ]) {
    const response = await request('POST', path, body)
    const [access, refresh] = response.setCookie ?? []
    assert.match(access, /^access_token=.+; Max-Age=300;/i, path)
    assert.match(refresh, /^refresh_token=/, path)
    assert.doesNotMatch(refresh, /Max-Age|Expires/i, path)
    assert.match(refresh, /HttpOnly/i, path)
    assert.equal((await sessionRows()).at(-1)?.persistent, false, path)
  }
})

test('JSON callers choose with remember, defaulting to session-only', async () => {
  await signUp()
  for (const [remember, persistent] of [
    [undefined, false],
    [true, true],
  ]) {
    const response = await request(
      'POST',
      '/login',
      JSON.stringify({ username: 'Lars', password: 'correct-horse', remember }),
      { 'content-type': 'application/json', ...json },
    )
    assert.equal(response.statusCode, 200)
    assert.equal(/Max-Age/i.test(response.setCookie?.[1] ?? ''), persistent)
  }
})

test('the choice survives a refresh', async (t) => {
  await signUp()
  for (const [remember, persistent] of [
    ['', false],
    ['&remember=1', true],
  ] as const) {
    await db().query('DELETE FROM sessions')
    const cookies = await (async () => {
      const response = await request(
        'POST',
        '/login',
        `username=Lars&password=correct-horse${remember}`,
      )
      return cookiesSet(response)
    })()
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 6 * 60 * 1000 })
    const later = await feedWithRefreshToken(cookies.refresh_token)
    t.mock.timers.reset()

    assert.equal(viewerName(later), 'Lars')
    const refresh = (later.setCookie ?? []).find((cookie) => cookie.startsWith('refresh_token='))
    assert.ok(refresh)
    assert.equal(/Max-Age=34560000/.test(refresh), persistent)
    assert.equal((await sessionRows())[0].persistent, persistent)
  }
})

test('a session-only login ends after a day unused, a persistent one does not', async () => {
  const temporary = await request('POST', '/createUser', 'username=Lars&password=correct-horse')
  const kept = await request('POST', '/login', 'username=Lars&password=correct-horse&remember=1')
  await db().query(`UPDATE sessions SET last_used_at = now() - interval '25 hours'`)

  const gone = await feedWithRefreshToken(cookiesSet(temporary).refresh_token)
  assert.equal(viewerName(gone), null)
  assert.equal(cookiesSet(gone).refresh_token, '')
  assert.equal(viewerName(await feedWithRefreshToken(cookiesSet(kept).refresh_token)), 'Lars')
})

test('a session from before the option existed refreshes as persistent', async (t) => {
  const cookies = await signUp()
  // Rows from before the migration got the column's default.
  await db().query('UPDATE sessions SET persistent = DEFAULT')

  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 6 * 60 * 1000 })
  const later = await feedWithRefreshToken(cookies.refresh_token)
  t.mock.timers.reset()

  assert.equal(viewerName(later), 'Lars')
  assert.match((later.setCookie ?? []).join('\n'), /refresh_token=.+; Max-Age=34560000/)
})

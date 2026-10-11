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

async function sessionRows(): Promise<{ generation: number; revoked: boolean }[]> {
  const { rows } = await db().query(
    `SELECT current_generation AS generation, revoked_at IS NOT NULL AS revoked
     FROM sessions ORDER BY created_at`,
  )
  return rows
}

test('sign-up sets a short access token and a long-lived refresh token, both HttpOnly', async () => {
  const response = await request('POST', '/createUser', 'username=Lars&password=correct-horse')

  const [access, refresh] = response.setCookie ?? []
  assert.match(access, /^access_token=.+; Max-Age=300;.*HttpOnly.*SameSite=Lax/i)
  assert.match(refresh, /^refresh_token=.+; Max-Age=34560000;.*Path=\/;.*HttpOnly.*SameSite=Lax/i)
  assert.deepEqual(await sessionRows(), [{ generation: 0, revoked: false }])
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
  assert.deepEqual(await sessionRows(), [{ generation: 1, revoked: false }])

  // Form POSTs refresh the same way, without JS.
  const post = await request('POST', '/api/blurts', 'text=Still+here', {
    cookie: `refresh_token=${rotated.refresh_token}`,
  })
  assert.equal(post.statusCode, 303)
  assert.equal(await countBlurts(), 1)
  assert.deepEqual(await sessionRows(), [{ generation: 2, revoked: false }])
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
  assert.deepEqual(await sessionRows(), [{ generation: 1, revoked: true }])
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
  assert.deepEqual(await sessionRows(), [{ generation: 1, revoked: false }])

  // A third tab a moment later is still within the window.
  assert.equal(viewerName(await feedWithRefreshToken(shared)), 'Lars')
  assert.equal(viewerName(await feedWithRefreshToken(refreshTokens[0])), 'Lars')
  assert.deepEqual(await sessionRows(), [{ generation: 2, revoked: false }])
})

test('a refresh token two generations old is a replay, even right away', async () => {
  const first = (await signUp()).refresh_token
  const second = cookiesSet(await feedWithRefreshToken(first)).refresh_token
  await feedWithRefreshToken(second)

  assert.equal(viewerName(await feedWithRefreshToken(first)), null)
  assert.deepEqual(await sessionRows(), [{ generation: 2, revoked: true }])
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
  assert.deepEqual(await sessionRows(), [{ generation: 0, revoked: false }])

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

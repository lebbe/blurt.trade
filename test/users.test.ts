import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db.ts'
import { app } from '../src/server.ts'
import { getUserByUsername } from '../src/routes/state.ts'
import { reservedUsernames } from '../src/routes/users.ts'
import { countBlurts, createSession, request } from './helpers.ts'

test('the old /createUser address redirects permanently to /signup, keeping the query', async () => {
  const plain = await request('GET', '/createUser')
  assert.equal(plain.statusCode, 301)
  assert.equal(plain.location, '/signup')

  const invited = await request('GET', '/createUser?invite=abc')
  assert.equal(invited.statusCode, 301)
  assert.equal(invited.location, '/signup?invite=abc')
})

test('creates a user, logs them in, and redirects to the feed', async () => {
  const form = await request('GET', '/signup')
  assert.equal(form.statusCode, 200)
  assert.match(form.body, /action="\/signup"/)

  const response = await request('POST', '/signup', 'username=Lars&password=correct-horse')

  assert.equal(response.statusCode, 303)
  assert.equal(response.location, '/')
  const user = await getUserByUsername('Lars')
  assert.ok(user)
  assert.notEqual(user.passwordHash, 'correct-horse')
  assert.match(response.setCookie?.[0] ?? '', /^access_token=.*HttpOnly/i)

  const authenticatedFeed = await request('GET', '/', '', {
    cookie: response.setCookie?.[0]?.split(';', 1)[0] ?? '',
  })
  assert.match(authenticatedFeed.body, /action="\/api\/blurts"/)
  assert.doesNotMatch(authenticatedFeed.body, /name="name"/)
  // Logging out is in settings, which the navigation links to from every page.
  assert.match(authenticatedFeed.body, /<nav class="top-nav"[^]*href="\/settings"/)
  const settings = await request('GET', '/settings', '', {
    cookie: response.setCookie?.[0]?.split(';', 1)[0] ?? '',
  })
  assert.match(settings.body, /action="\/api\/logout"/)

  const logout = await request('POST', '/api/logout', '', {
    cookie: response.setCookie?.[0]?.split(';', 1)[0] ?? '',
  })
  assert.equal(logout.statusCode, 303)
  assert.equal(logout.location, '/')
  assert.match(logout.setCookie?.[0] ?? '', /access_token=;/)
  assert.match(logout.setCookie?.[0] ?? '', /Max-Age=0/i)
})

test('logs in with the password stored in the database', async () => {
  await createSession('Lars')

  const wrong = await request('POST', '/login', 'username=Lars&password=wrong-horse')
  assert.equal(wrong.statusCode, 400)
  assert.match(wrong.body, /Invalid username or password/)

  const right = await request('POST', '/login', 'username=Lars&password=correct-horse')
  assert.equal(right.statusCode, 303)
  assert.match(right.setCookie?.[0] ?? '', /^access_token=/)
})

test('logs out a valid token whose user no longer exists', async () => {
  const cookie = await createSession('Lars')
  await db().query('TRUNCATE users, user_profiles, blurts RESTART IDENTITY CASCADE')

  const response = await request('POST', '/api/blurts', 'text=Hello+world', { cookie })

  assert.equal(response.statusCode, 303)
  assert.equal(response.location, '/')
  assert.match(response.setCookie?.[0] ?? '', /Max-Age=0/i)
  assert.equal(await countBlurts(), 0)
})

test('every top-level route is a reserved username, and every POST has a page or lives under /api/', () => {
  type Layer = {
    route?: { path: string; methods: Record<string, boolean> }
    handle: { stack?: Layer[] }
  }
  const layers = (app.router as unknown as { stack: Layer[] }).stack
  const routes = layers.flatMap((layer) =>
    layer.route ? [layer.route] : (layer.handle.stack ?? []).flatMap((inner) => inner.route ?? []),
  )
  assert.ok(routes.length > 5, 'could not read the route table')

  for (const route of routes) {
    const firstSegment = route.path.split('/')[1]
    if (firstSegment && !firstSegment.startsWith(':')) {
      assert.ok(
        reservedUsernames.has(firstSegment.toLowerCase()),
        `"${firstSegment}" (from ${route.path}) must be in reservedUsernames`,
      )
    }
    if (route.methods.post && !route.path.startsWith('/api/')) {
      assert.ok(
        routes.some((other) => other.path === route.path && other.methods.get),
        `POST ${route.path} has no GET page at the same path, so it must live under /api/`,
      )
    }
  }
})

test('rejects reserved usernames in any letter case', async () => {
  for (const username of ['login', 'Login', 'API', 'createUser', 'signup', 'SignUp', 'settings']) {
    const response = await request('POST', '/signup', `username=${username}&password=correct-horse`)
    assert.equal(response.statusCode, 400, username)
    assert.match(response.body, /That username is reserved/)
  }
  assert.equal(await getUserByUsername('login'), undefined)
})

test('rejects usernames that are not safe as a URL segment', async () => {
  for (const username of ['a/b', 'favicon.ico', 'with space', 'x?y', 'æøå']) {
    const response = await request(
      'POST',
      '/signup',
      `username=${encodeURIComponent(username)}&password=correct-horse`,
    )
    assert.equal(response.statusCode, 400, username)
    assert.match(response.body, /letters, numbers and underscores/)
  }
})

test('treats usernames as case-insensitive', async () => {
  await createSession('Lars')

  const taken = await request('POST', '/signup', 'username=lars&password=other-horse')
  assert.equal(taken.statusCode, 400)
  assert.match(taken.body, /Username is already taken/)

  const profile = await request('GET', '/lars/')
  assert.equal(profile.statusCode, 200)
  assert.match(profile.body, /<h1>Lars<\/h1>/)

  const login = await request('POST', '/login', 'username=LARS&password=correct-horse')
  assert.equal(login.statusCode, 303)
})

test('the database rejects unsafe usernames even if the app does not', async () => {
  await assert.rejects(
    db().query(`INSERT INTO users (username, password_hash) VALUES ('a/b', 'x')`),
    /users_username_format/,
  )
})

import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { migrate } from '../db/migrate.ts'
import { closeDb, db, dbRead, poolSize } from './db.ts'
import { embedPendingBlurts, setEmbedder } from './embeddings.ts'
import { app } from './server.ts'
import { deleteBlurts, getUserByUsername, getUserProfileByUsername } from './routes/state.ts'
import { reservedUsernames } from './routes/users.ts'
import { mapHeight, mapUrl, mapWidth } from './geo.ts'
import { recentWriteCookie } from './middleware/replica.ts'
import {
  clientKey,
  parseLimit,
  resetRateLimits,
  setRateLimitScale,
  take,
  trustProxySetting,
} from './middleware/rate-limit.ts'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import {
  avatarPalettes,
  eyeTypes,
  hairTypes,
  randomAvatar,
  toothTypes,
  type Avatar,
} from './avatar.ts'
import { AvatarSvg } from './templates/avatar.ts'
import { renderProfilePage } from './templates/index.ts'
import { bodyLimit } from './limits.ts'

// Never the dev database: every test wipes all tables. Like the app, queries go through
// PgBouncer (6433) and migrations straight to PostgreSQL (5433).
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://blurt:blurt@localhost:6433/blurt_test'
const testMigrationDatabaseUrl =
  process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://blurt:blurt@localhost:5433/blurt_test'

function request(
  method: string,
  path: string,
  body = '',
  headers: Record<string, string> = {},
): Promise<{
  statusCode: number
  contentType?: string
  location?: string
  setCookie?: string[]
  retryAfter?: string
  body: string
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
        (response: {
          statusCode?: number
          headers: {
            'content-type'?: string
            location?: string
            'set-cookie'?: string[]
            'retry-after'?: string
          }
          on: (event: string, callback: (chunk?: Buffer) => void) => void
        }) => {
          let responseBody = ''
          response.on('data', (chunk) => {
            responseBody += chunk?.toString() ?? ''
          })
          response.on('end', () => {
            server.close()
            resolve({
              statusCode: response.statusCode ?? 0,
              contentType: response.headers['content-type'],
              location: response.headers.location,
              setCookie: response.headers['set-cookie'],
              retryAfter: response.headers['retry-after'],
              body: responseBody,
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

// Many tests sign up more users from one address than the real limits allow; the rate
// limit tests below switch back to the real limits.
setRateLimitScale(1000)

test.beforeEach(async () => {
  resetRateLimits()
  await db().query(
    'TRUNCATE users, user_profiles, blurts, waitlist, invite_codes RESTART IDENTITY CASCADE',
  )
  await setSignupLimits(1000, 10000)
})

// Also resets the count, so the limits apply from zero sign-ups.
async function setSignupLimits(softLimit: number, hardLimit: number): Promise<void> {
  await db().query(
    'UPDATE signup_counter SET current_count = 0, soft_limit = $1, hard_limit = $2',
    [softLimit, hardLimit],
  )
}

async function signupCount(): Promise<number> {
  const { rows } = await db().query('SELECT current_count FROM signup_counter')
  return rows[0].current_count
}

test.after(async () => {
  await embedPendingBlurts()
  await closeDb()
})

async function countBlurts(): Promise<number> {
  const { rows } = await db().query('SELECT count(*)::int AS count FROM blurts')
  return rows[0].count
}

async function insertBlurt(username: string, text: string, createdAt: Date): Promise<void> {
  await db().query(
    'INSERT INTO blurts (user_id, text, created_at) SELECT id, $2, $3 FROM users WHERE username = $1',
    [username, text, createdAt],
  )
}

async function createSession(username = 'Lars'): Promise<string> {
  const response = await request(
    'POST',
    '/createUser',
    `username=${encodeURIComponent(username)}&password=correct-horse`,
  )
  assert.equal(response.statusCode, 303)
  return response.setCookie?.[0]?.split(';', 1)[0] ?? ''
}

test('shows the empty feed', async () => {
  const response = await request('GET', '/')

  assert.equal(response.statusCode, 200)
  assert.match(response.body, /Nothing has been blurted yet/)
  assert.doesNotMatch(response.body, /action="\/api\/blurts"/)
  assert.match(response.body, /href="\/login"/)
  assert.match(response.body, /href="\/createUser"/)
})

test('serves the feed as JSON when requested', async () => {
  const createdAt = new Date('2026-10-10T12:00:00.000Z')
  await createSession('Lars')
  await insertBlurt('Lars', 'Hello world', createdAt)

  const response = await request('GET', '/', '', { accept: 'application/json' })

  assert.equal(response.statusCode, 200)
  const data = JSON.parse(response.body)
  // Random at sign-up: checked in the avatar tests.
  assert.deepEqual(data.blurts[0].avatar, (await getUserProfileByUsername('Lars'))?.avatar)
  delete data.blurts[0].avatar
  assert.deepEqual(data, {
    viewer: null,
    feed: 'everyone',
    hasFollowingFeed: false,
    followedBlurts: [],
    blurts: [
      {
        id: 1,
        username: 'Lars',
        text: 'Hello world',
        createdAt: createdAt.toISOString(),
        parentId: null,
        replyCount: 0,
        deleted: false,
        replies: [],
      },
    ],
    discovery: [],
    next: null,
  })
})

test('serves the feed as Markdown when plain text is requested', async () => {
  const createdAt = new Date('2026-10-10T12:00:00.000Z')
  await createSession('Lars')
  await insertBlurt('Lars', 'Hello *world*', createdAt)

  const response = await request('GET', '/', '', { accept: 'text/plain' })

  assert.equal(response.statusCode, 200)
  assert.match(response.body, /# blurt\.trade/)
  assert.match(response.body, /### Lars/)
  assert.ok(response.body.includes('Hello \\*world\\*'))
})

test('rejects unsupported feed representations', async () => {
  const response = await request('GET', '/', '', { accept: 'application/xml' })

  assert.equal(response.statusCode, 406)
})

test('rejects blurt submissions without authentication', async () => {
  const response = await request('POST', '/api/blurts', 'text=Hello+world')

  assert.equal(response.statusCode, 401)
  assert.equal(await countBlurts(), 0)
})

test('creates a blurt and redirects back to the feed', async () => {
  const cookie = await createSession()
  const response = await request('POST', '/api/blurts', 'text=Hello+world', { cookie })

  assert.equal(response.statusCode, 303)
  assert.equal(response.location, '/')
  const { rows } = await db().query('SELECT user_id, text FROM blurts')
  assert.deepEqual(rows, [{ user_id: 1, text: 'Hello world' }])
})

test('renders submitted input and validation errors for an invalid blurt', async () => {
  const cookie = await createSession()
  const response = await request('POST', '/api/blurts', 'text=', { cookie })

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /Blurt is required/)
  assert.equal(await countBlurts(), 0)
})

test('creates a user, logs them in, and redirects to the feed', async () => {
  const form = await request('GET', '/createUser')
  assert.equal(form.statusCode, 200)
  assert.match(form.body, /action="\/createUser"/)

  const response = await request('POST', '/createUser', 'username=Lars&password=correct-horse')

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
  assert.match(authenticatedFeed.body, /action="\/api\/logout"/)

  const logout = await request('POST', '/api/logout', '', {
    cookie: response.setCookie?.[0]?.split(';', 1)[0] ?? '',
  })
  assert.equal(logout.statusCode, 303)
  assert.equal(logout.location, '/')
  assert.match(logout.setCookie?.[0] ?? '', /access_token=;/)
  assert.match(logout.setCookie?.[0] ?? '', /Max-Age=0/i)
})

test('shows only one user feed and profile data on profile route', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')

  await request('POST', '/api/blurts', 'text=Lars+post', { cookie: larsCookie })
  await request('POST', '/api/blurts', 'text=Ada+post', { cookie: adaCookie })

  const response = await request('GET', '/Lars/', '', { cookie: larsCookie })

  assert.equal(response.statusCode, 200)
  assert.match(response.body, /<h1>Lars<\/h1>/)
  assert.match(response.body, /Lars post/)
  assert.doesNotMatch(response.body, /Ada post/)
  assert.match(response.body, /href="\/Lars\/edit"/)
  assert.match(response.body, /Homepage/)
  assert.match(response.body, /LinkedIn/)
})

test('hides edit button when viewing someone else profile', async () => {
  await createSession('Lars')
  const adaCookie = await createSession('Ada')

  const response = await request('GET', '/Lars/', '', { cookie: adaCookie })

  assert.equal(response.statusCode, 200)
  assert.doesNotMatch(response.body, /href="\/Lars\/edit"/)
})

test('validates and updates profile fields for the owner', async () => {
  const larsCookie = await createSession('Lars')

  const invalid = await request('POST', '/Lars/edit', 'homepage=not-a-url&bio=hello', {
    cookie: larsCookie,
  })

  assert.equal(invalid.statusCode, 400)
  assert.match(invalid.body, /Homepage must be a full URL starting with https:\/\/ or http:\/\//)

  const valid = await request(
    'POST',
    '/Lars/edit',
    'homepage=https%3A%2F%2Fexample.com&x=%40lars&instagram=&tiktok=&youtube=&github=https%3A%2F%2Fgithub.com%2Flars&linkedin=&bio=hello+there',
    {
      cookie: larsCookie,
    },
  )

  assert.equal(valid.statusCode, 303)
  assert.equal(valid.location, '/Lars/')
  const profile = await getUserProfileByUsername('Lars')
  assert.equal(profile?.homepage, 'https://example.com')
  assert.equal(profile?.x, '@lars')
  assert.equal(profile?.github, 'https://github.com/lars')
  assert.equal(profile?.bio, 'hello there')
})

test('forbids profile edits from non-owners', async () => {
  await createSession('Lars')
  const adaCookie = await createSession('Ada')

  const response = await request('POST', '/Lars/edit', 'bio=ada+was+here', {
    cookie: adaCookie,
  })

  assert.equal(response.statusCode, 403)
  assert.equal((await getUserProfileByUsername('Lars'))?.bio, '')
})

test('forbids opening the edit page of someone else', async () => {
  await createSession('Lars')
  const adaCookie = await createSession('Ada')

  const response = await request('GET', '/Lars/edit', '', { cookie: adaCookie })

  assert.equal(response.statusCode, 403)
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

test('rejects a username that is already taken', async () => {
  await createSession('Lars')

  const response = await request('POST', '/createUser', 'username=Lars&password=other-horse')

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /Username is already taken/)
})

test('shows the feed newest first', async () => {
  await createSession('Lars')
  await insertBlurt('Lars', 'older', new Date('2026-10-10T12:00:00.000Z'))
  await insertBlurt('Lars', 'newer', new Date('2026-10-10T13:00:00.000Z'))

  const response = await request('GET', '/', '', { accept: 'application/json' })

  assert.deepEqual(
    JSON.parse(response.body).blurts.map((blurt: { text: string }) => blurt.text),
    ['newer', 'older'],
  )
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

test('re-renders the edit form with the submitted values on validation errors', async () => {
  const larsCookie = await createSession('Lars')

  const response = await request('POST', '/Lars/edit', 'homepage=example.com&bio=keep+me', {
    cookie: larsCookie,
  })

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /Edit profile: Lars/)
  assert.match(response.body, /value="example\.com"/)
  assert.match(response.body, /keep me/)
  assert.equal((await getUserProfileByUsername('Lars'))?.bio, '')
})

test('rejects non-http(s) links in profile fields', async () => {
  const larsCookie = await createSession('Lars')

  const response = await request(
    'POST',
    '/Lars/edit',
    'homepage=javascript%3Aalert(1)&x=javascript%3Aalert(1)&instagram=&tiktok=&youtube=&github=&linkedin=&bio=',
    { cookie: larsCookie },
  )

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /Homepage must be a full URL/)
  assert.match(response.body, /Social fields must be a username\/handle or a full http\(s\) URL/)
  assert.equal((await getUserProfileByUsername('Lars'))?.homepage, '')
})

test('never stores or renders a non-http(s) link as a href', async () => {
  await createSession('Lars')
  await assert.rejects(
    db().query(`UPDATE user_profiles SET homepage = 'javascript:alert(1)'`),
    /user_profiles_homepage_web_url/,
  )
  await assert.rejects(
    db().query(`UPDATE user_profiles SET github = 'javascript:alert(1)'`),
    /user_profiles_github_valid/,
  )

  // The templates don't trust the database either.
  const data = JSON.parse((await request('GET', '/Lars/', '', json)).body)
  for (const homepage of ['javascript:alert(1)', ' http://example.com', 'http:example.com']) {
    const page = renderProfilePage({ ...data, profile: { ...data.profile, homepage } })
    assert.doesNotMatch(page, /href="(javascript:|http:example| http)/, homepage)
    assert.ok(page.includes(homepage.trim()), homepage)
  }
})

async function blurtIdByText(text: string): Promise<number> {
  const { rows } = await db().query('SELECT id FROM blurts WHERE text = $1', [text])
  return rows[0].id
}

test('replies to a blurt and shows the thread on the blurt page', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=Original+blurt', { cookie: larsCookie })
  const id = await blurtIdByText('Original blurt')

  const reply = await request('POST', '/api/blurts', `parentId=${id}&text=Nice+one`, {
    cookie: adaCookie,
  })
  assert.equal(reply.statusCode, 303)
  assert.equal(reply.location, `/Lars/${id}`)

  const page = await request('GET', `/Lars/${id}`)
  assert.equal(page.statusCode, 200)
  assert.match(page.body, /Original blurt/)
  assert.match(page.body, /Nice one/)

  const replyId = await blurtIdByText('Nice one')
  const replyPage = await request('GET', `/Ada/${replyId}`)
  assert.match(replyPage.body, /In reply to/)
  assert.match(replyPage.body, /Original blurt/)
})

test('re-renders the blurt page with the error for an invalid reply', async () => {
  const cookie = await createSession('Lars')
  await request('POST', '/api/blurts', 'text=Original+blurt', { cookie })
  const id = await blurtIdByText('Original blurt')

  const response = await request('POST', '/api/blurts', `parentId=${id}&text=`, { cookie })

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /Blurt is required/)
  assert.match(response.body, /Original blurt/)
  assert.equal(await countBlurts(), 1)
})

test('rejects replies without authentication', async () => {
  const cookie = await createSession('Lars')
  await request('POST', '/api/blurts', 'text=Original+blurt', { cookie })
  const id = await blurtIdByText('Original blurt')

  const response = await request('POST', '/api/blurts', `parentId=${id}&text=Hi`)

  assert.equal(response.statusCode, 401)
  assert.equal(await countBlurts(), 1)
})

test('feed lists top-level blurts with their latest two replies', async () => {
  const cookie = await createSession('Lars')
  await request('POST', '/api/blurts', 'text=Original+blurt', { cookie })
  const id = await blurtIdByText('Original blurt')
  for (const text of ['first', 'second', 'third']) {
    await request('POST', '/api/blurts', `parentId=${id}&text=${text}+reply`, { cookie })
  }

  const json = await request('GET', '/', '', { accept: 'application/json' })
  const feed = JSON.parse(json.body).blurts
  assert.equal(feed.length, 1)
  assert.equal(feed[0].replyCount, 3)
  assert.deepEqual(
    feed[0].replies.map((reply: { text: string }) => reply.text),
    ['second reply', 'third reply'],
  )

  const page = await request('GET', '/')
  assert.match(page.body, /1 more reply/)
  assert.doesNotMatch(page.body, /first reply/)
})

test('shows related blurts once embeddings are computed', async () => {
  const cookie = await createSession('Lars')
  for (const text of ['my cat is great', 'cat videos all day', 'stock market news']) {
    await request('POST', '/api/blurts', `text=${encodeURIComponent(text)}`, { cookie })
  }
  await embedPendingBlurts()
  const id = await blurtIdByText('my cat is great')

  const page = await request('GET', `/Lars/${id}`)
  const related = page.body.slice(page.body.indexOf('Related blurts'))

  assert.match(related, /cat videos all day/)
  assert.doesNotMatch(related, /stock market news/)
  assert.doesNotMatch(related, /my cat is great/)
})

test('returns 404 for a blurt under the wrong username', async () => {
  await createSession('Ada')
  const cookie = await createSession('Lars')
  await request('POST', '/api/blurts', 'text=Original+blurt', { cookie })
  const id = await blurtIdByText('Original blurt')

  const response = await request('GET', `/Ada/${id}`)

  assert.equal(response.statusCode, 404)
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
  for (const username of ['login', 'Login', 'API', 'createUser', 'settings']) {
    const response = await request(
      'POST',
      '/createUser',
      `username=${username}&password=correct-horse`,
    )
    assert.equal(response.statusCode, 400, username)
    assert.match(response.body, /That username is reserved/)
  }
  assert.equal(await getUserByUsername('login'), undefined)
})

test('rejects usernames that are not safe as a URL segment', async () => {
  for (const username of ['a/b', 'favicon.ico', 'with space', 'x?y', 'æøå']) {
    const response = await request(
      'POST',
      '/createUser',
      `username=${encodeURIComponent(username)}&password=correct-horse`,
    )
    assert.equal(response.statusCode, 400, username)
    assert.match(response.body, /letters, numbers and underscores/)
  }
})

test('treats usernames as case-insensitive', async () => {
  await createSession('Lars')

  const taken = await request('POST', '/createUser', 'username=lars&password=other-horse')
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

const json = { accept: 'application/json' }

function sendJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  return request('POST', path, JSON.stringify(body), {
    ...json,
    'content-type': 'application/json',
    ...headers,
  })
}

test('serves every GET page as JSON with the data the HTML is rendered from', async () => {
  const cookie = await createSession('Lars')
  await createSession('Ada')
  await request('POST', '/api/blurts', 'text=Original+blurt', { cookie })
  const id = await blurtIdByText('Original blurt')
  await request('POST', '/api/blurts', `parentId=${id}&text=Nice+one`, { cookie })
  const replyId = await blurtIdByText('Nice one')
  const texts = (blurts: { text: string }[]) => blurts.map((blurt) => blurt.text)

  const pages: [string, (data: Record<string, any>) => void][] = [
    ['/', (data) => assert.deepEqual(texts(data.blurts[0].replies), ['Nice one'])],
    [
      '/lars/',
      (data) => {
        assert.equal(data.profile.username, 'Lars')
        assert.equal(data.invitedBy, null)
        assert.equal(data.inviteCodes.length, 3)
        assert.deepEqual(texts(data.blurts), ['Nice one', 'Original blurt'])
      },
    ],
    [
      `/Lars/${id}`,
      (data) => {
        assert.equal(data.blurt.text, 'Original blurt')
        assert.equal(data.parent, null)
        assert.deepEqual(texts(data.replies), ['Nice one'])
        assert.deepEqual(data.related, [])
      },
    ],
    [`/Lars/${replyId}`, (data) => assert.equal(data.parent.text, 'Original blurt')],
    [
      '/Lars/edit',
      (data) => {
        assert.equal(data.profile.bio, '')
        assert.equal(data.location, null)
      },
    ],
    [
      '/near',
      (data) => {
        assert.equal(data.location, null)
        assert.equal(data.radius, 250)
        assert.deepEqual(data.blurts, [])
      },
    ],
    ['/login', (data) => assert.deepEqual(Object.keys(data), ['viewer'])],
    ['/createUser', (data) => assert.equal(data.signup, 'open')],
    [
      '/waitlist',
      (data) => {
        assert.deepEqual(Object.keys(data), ['viewer', 'signup', 'waiting', 'username', 'entry'])
        assert.equal(data.waiting, 0)
      },
    ],
  ]

  for (const [path, check] of pages) {
    const response = await request('GET', path, '', { ...json, cookie })
    assert.equal(response.statusCode, 200, path)
    assert.match(response.contentType ?? '', /^application\/json/, path)
    assert.doesNotMatch(response.body, /password/i, path)
    const data = JSON.parse(response.body)
    assert.deepEqual(data.viewer, { id: 1, username: 'Lars' }, path)
    check(data)
  }

  const anonymous = await request('GET', '/', '', json)
  assert.equal(JSON.parse(anonymous.body).viewer, null)
})

test('serves every GET page as Markdown', async () => {
  const cookie = await createSession('Lars')
  await request('POST', '/api/blurts', 'text=Original+blurt', { cookie })
  const id = await blurtIdByText('Original blurt')

  const pages: [string, RegExp][] = [
    ['/', /^# blurt\.trade/],
    ['/Lars/', /^# Lars\n[^]*- Bio: _Not set_[^]*\[Edit profile\]\(<\/Lars\/edit>\)/],
    [`/Lars/${id}`, /^# Lars\n[^]*Original blurt[^]*## Replies\n\nNothing here yet\./],
    ['/Lars/edit', /^# Edit profile: Lars\n[^]*`POST \/Lars\/edit`[^]*`POST \/api\/avatar`/],
    ['/login', /^# Log in\n[^]*`POST \/login`/],
    ['/createUser', /^# Create a profile\n[^]*`POST \/createUser`/],
    ['/waitlist', /^# Waitlist\n[^]*0 people waiting/],
    ['/near', /^# Blurts near you\n[^]*You haven't set a location\./],
  ]

  for (const [path, expected] of pages) {
    for (const accept of ['text/markdown', 'text/plain']) {
      const response = await request('GET', path, '', { accept, cookie })
      assert.equal(response.statusCode, 200, path)
      assert.ok(response.contentType?.startsWith(accept), path)
      assert.match(response.body, expected, path)
    }
  }
})

test('answers errors as JSON for JSON clients', async () => {
  await createSession('Lars')
  const adaCookie = await createSession('Ada')

  const cases: [string, string, Record<string, string>, number][] = [
    ['GET', '/nobody/', {}, 404],
    ['GET', '/Lars/999', {}, 404],
    ['GET', '/Lars/edit', {}, 401],
    ['GET', '/Lars/edit', { cookie: adaCookie }, 403],
    ['POST', '/api/blurts', {}, 401],
  ]
  for (const [method, path, headers, status] of cases) {
    const response = await request(method, path, '', { ...json, ...headers })
    assert.equal(response.statusCode, status, path)
    assert.equal(typeof JSON.parse(response.body).error, 'string', path)
  }

  const malformed = await request('POST', '/login', '{', {
    ...json,
    'content-type': 'application/json',
  })
  assert.equal(malformed.statusCode, 400)
  assert.equal(typeof JSON.parse(malformed.body).error, 'string')
})

test('POST routes answer JSON callers with JSON instead of redirects', async () => {
  const invalidUser = await sendJson('/createUser', { username: 'a/b', password: 'short' })
  assert.equal(invalidUser.statusCode, 400)
  assert.deepEqual(
    JSON.parse(invalidUser.body).errors.map((error: { field: string }) => error.field),
    ['username', 'password'],
  )

  const created = await sendJson('/createUser', { username: 'Ada', password: 'correct-horse' })
  assert.equal(created.statusCode, 201)
  assert.equal(created.location, '/Ada/')
  assert.deepEqual(JSON.parse(created.body), { id: 1, username: 'Ada' })
  assert.match(created.setCookie?.[0] ?? '', /^access_token=/)

  const taken = await sendJson('/createUser', { username: 'ada', password: 'correct-horse' })
  assert.deepEqual(JSON.parse(taken.body), {
    errors: [{ field: 'username', message: 'Username is already taken' }],
  })

  const wrong = await sendJson('/login', { username: 'Ada', password: 'wrong-horse' })
  assert.equal(wrong.statusCode, 400)
  assert.deepEqual(JSON.parse(wrong.body), {
    errors: [{ message: 'Invalid username or password' }],
  })

  const login = await sendJson('/login', { username: 'ADA', password: 'correct-horse' })
  assert.equal(login.statusCode, 200)
  assert.deepEqual(JSON.parse(login.body), { id: 1, username: 'Ada' })
  const cookie = login.setCookie?.[0]?.split(';', 1)[0] ?? ''

  const blurt = await sendJson('/api/blurts', { text: 'From fetch' }, { cookie })
  assert.equal(blurt.statusCode, 201)
  const newBlurt = JSON.parse(blurt.body)
  assert.equal(newBlurt.text, 'From fetch')
  assert.equal(blurt.location, `/Ada/${newBlurt.id}`)

  const reply = await sendJson('/api/blurts', { parentId: newBlurt.id, text: 'Hi' }, { cookie })
  assert.equal(reply.statusCode, 201)
  assert.equal(JSON.parse(reply.body).parentId, newBlurt.id)

  const missingParent = await sendJson('/api/blurts', { parentId: 999, text: 'Hi' }, { cookie })
  assert.equal(missingParent.statusCode, 404)

  const empty = await sendJson('/api/blurts', { text: ' ' }, { cookie })
  assert.equal(empty.statusCode, 400)
  assert.deepEqual(JSON.parse(empty.body), {
    errors: [{ field: 'text', message: 'Blurt is required' }],
  })

  const invalidProfile = await sendJson('/Ada/edit', { homepage: 'nope' }, { cookie })
  assert.equal(invalidProfile.statusCode, 400)
  assert.equal(JSON.parse(invalidProfile.body).errors[0].field, 'homepage')

  const profile = await sendJson('/Ada/edit', { bio: 'Hello from JSON' }, { cookie })
  assert.equal(profile.statusCode, 200)
  assert.equal(JSON.parse(profile.body).bio, 'Hello from JSON')

  const logout = await sendJson('/api/logout', {}, { cookie })
  assert.equal(logout.statusCode, 204)
  assert.match(logout.setCookie?.[0] ?? '', /Max-Age=0/i)

  for (const response of [created, login, blurt, profile]) {
    assert.doesNotMatch(response.body, /password/i)
  }
})

// `count` blurts by Lars, `blurt 1` oldest. Every `tie` of them share one created_at, with
// microseconds a JS Date can't hold, so page boundaries fall inside a group of equal times.
async function insertBlurts(count: number, parentId: number | null = null, tie = 7): Promise<void> {
  await db().query(
    `INSERT INTO blurts (user_id, text, parent_id, created_at)
     SELECT u.id, 'blurt ' || i, $2,
       timestamptz '2026-10-10 12:00:00.123456+00' + ((i - 1) / $3) * interval '1 second'
     FROM users u, generate_series(1, $1) AS i WHERE u.username = 'Lars' ORDER BY i`,
    [count, parentId, tie],
  )
}

function blurtTexts(numbers: number[]): string[] {
  return numbers.map((n) => `blurt ${n}`)
}

// Follows `next` cursors through the JSON pages, returning each page's texts.
async function jsonPages(
  path: string,
  param: 'before' | 'after',
  list: (data: Record<string, any>) => { text: string }[],
): Promise<string[][]> {
  const pages: string[][] = []
  let url = path
  for (;;) {
    const response = await request('GET', url, '', json)
    assert.equal(response.statusCode, 200, url)
    const data = JSON.parse(response.body)
    pages.push(list(data).map((blurt) => blurt.text))
    if (data.next === null) {
      return pages
    }
    assert.equal(typeof data.next, 'string')
    url = `${path}?${param}=${data.next}`
  }
}

// Follows the "Older blurts" / "More replies" links through the HTML pages, as a browser
// without JS would.
async function htmlPages(path: string, label: string): Promise<string[][]> {
  const pages: string[][] = []
  let url: string | undefined = path
  while (url) {
    const response = await request('GET', url)
    assert.equal(response.statusCode, 200, url)
    pages.push([...response.body.matchAll(/<p>(blurt \d+)<\/p>/g)].map((match) => match[1]))
    url = new RegExp(`<a href="([^"]+)" rel="next">${label}</a>`).exec(response.body)?.[1]
  }
  return pages
}

test('pages through the feed newest first, with and without JS', async () => {
  await createSession('Lars')
  await insertBlurts(250)
  const newestFirst = blurtTexts(Array.from({ length: 250 }, (_, i) => 250 - i))

  const pages = await jsonPages('/', 'before', (data) => data.blurts)
  assert.deepEqual(
    pages.map((page) => page.length),
    [100, 100, 50],
  )
  assert.deepEqual(pages.flat(), newestFirst)

  const htmlResult = await htmlPages('/', 'Older blurts')
  assert.deepEqual(htmlResult, pages)

  const markdown = await request('GET', '/', '', { accept: 'text/markdown' })
  assert.match(markdown.body, /\[Older blurts\]\(<\/\?before=[\w-]+>\)/)
})

test('a page boundary inside blurts with the same created_at loses nothing', async () => {
  await createSession('Lars')
  // All 101 share one timestamp, so only the id orders them across the boundary.
  await insertBlurts(101, null, 1000)

  const pages = await jsonPages('/', 'before', (data) => data.blurts)
  assert.deepEqual(
    pages.map((page) => page.length),
    [100, 1],
  )
  assert.deepEqual(pages[1], ['blurt 1'])
})

test('new blurts do not shift the pages after the first', async () => {
  const cookie = await createSession('Lars')
  await insertBlurts(150)

  const first = JSON.parse((await request('GET', '/', '', json)).body)
  await request('POST', '/api/blurts', 'text=Brand+new', { cookie })
  const second = JSON.parse((await request('GET', `/?before=${first.next}`, '', json)).body)

  assert.equal(first.blurts.at(-1).text, 'blurt 51')
  assert.deepEqual(
    second.blurts.map((blurt: { text: string }) => blurt.text),
    blurtTexts(Array.from({ length: 50 }, (_, i) => 50 - i)),
  )
  assert.equal(second.next, null)
})

test('pages through a profile newest first', async () => {
  await createSession('Lars')
  await insertBlurts(130)

  const pages = await jsonPages('/Lars/', 'before', (data) => data.blurts)
  assert.deepEqual(pages.flat(), blurtTexts(Array.from({ length: 130 }, (_, i) => 130 - i)))
  assert.deepEqual(await htmlPages('/Lars/', 'Older blurts'), pages)

  const markdown = await request('GET', '/Lars/', '', { accept: 'text/markdown' })
  assert.match(markdown.body, /\[Older blurts\]\(<\/Lars\/\?before=[\w-]+>\)/)
})

test('pages through the replies on a blurt page oldest first', async () => {
  const cookie = await createSession('Lars')
  await request('POST', '/api/blurts', 'text=Original+blurt', { cookie })
  const id = await blurtIdByText('Original blurt')
  await insertBlurts(120, id)

  const pages = await jsonPages(`/Lars/${id}`, 'after', (data) => data.replies)
  assert.deepEqual(
    pages.map((page) => page.length),
    [100, 20],
  )
  assert.deepEqual(pages.flat(), blurtTexts(Array.from({ length: 120 }, (_, i) => i + 1)))
  assert.deepEqual(await htmlPages(`/Lars/${id}`, 'More replies'), pages)

  const markdown = await request('GET', `/Lars/${id}`, '', { accept: 'text/markdown' })
  assert.ok(markdown.body.includes(`[More replies](</Lars/${id}?after=`))
})

test('rejects malformed cursors', async () => {
  await createSession('Lars')
  await insertBlurt('Lars', 'Hello world', new Date('2026-10-10T12:00:00.000Z'))
  const cursor = (text: string) => Buffer.from(text).toString('base64url')

  for (const query of [
    'before=nonsense',
    `before=${cursor('2026-13-01T00:00:00.000000Z_1')}`,
    `before=${cursor('2026-10-10T12:00:00.000Z_1')}`,
    'before=a&before=b',
  ]) {
    for (const path of ['/', '/Lars/']) {
      const response = await request('GET', `${path}?${query}`, '', json)
      assert.equal(response.statusCode, 400, `${path}?${query}`)
      assert.equal(JSON.parse(response.body).error, 'Invalid cursor')
    }
  }
  const reply = await request('GET', '/Lars/1?after=nonsense', '', json)
  assert.equal(reply.statusCode, 400)
})

// Users without profiles or real passwords, each with one top-level blurt and one reply to
// it, for feed tests that don't need to log them in.
async function insertFollowees(count: number): Promise<void> {
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
async function followFirst(username: string, count: number): Promise<void> {
  await db().query(
    `INSERT INTO follows (user_id, followed_user_id)
     SELECT f.id, u.id FROM users f, users u, generate_series(1, $2) AS i
     WHERE f.username = $1 AND u.username = 'user' || i`,
    [username, count],
  )
}

test('follows and unfollows from the profile page without JS', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')

  const before = await request('GET', '/Lars/', '', { cookie: adaCookie })
  assert.match(before.body, /0 followers · 0 following/)
  assert.match(before.body, /action="\/api\/follow"[^]*name="username" value="Lars"[^]*>Follow</)

  const followed = await request('POST', '/api/follow', 'username=lars', { cookie: adaCookie })
  assert.equal(followed.statusCode, 303)
  assert.equal(followed.location, '/Lars/')
  // Following twice is harmless.
  await request('POST', '/api/follow', 'username=Lars', { cookie: adaCookie })

  const after = await request('GET', '/Lars/', '', { cookie: adaCookie })
  assert.match(after.body, /1 follower · 0 following/)
  assert.match(after.body, /action="\/api\/unfollow"[^]*>Unfollow</)
  assert.match((await request('GET', '/Ada/')).body, /0 followers · 1 following/)

  // No follow button on your own profile or for anonymous visitors.
  const own = await request('GET', '/Lars/', '', { cookie: larsCookie })
  assert.doesNotMatch(own.body, /api\/(un)?follow/)
  assert.doesNotMatch((await request('GET', '/Lars/')).body, /api\/(un)?follow/)

  const unfollowed = await request('POST', '/api/unfollow', 'username=Lars', { cookie: adaCookie })
  assert.equal(unfollowed.statusCode, 303)
  assert.equal(unfollowed.location, '/Lars/')
  assert.match((await request('GET', '/Lars/')).body, /0 followers · 0 following/)
})

test('follow answers JSON callers with the follow stats, and rejects bad follows', async () => {
  await createSession('Lars')
  const adaCookie = await createSession('Ada')

  const followed = await request('POST', '/api/follow', 'username=Lars', {
    ...json,
    cookie: adaCookie,
  })
  assert.equal(followed.statusCode, 200)
  const stats = { followerCount: 1, followingCount: 0, viewerFollows: true }
  assert.deepEqual(JSON.parse(followed.body), stats)

  const profile = await request('GET', '/Lars/', '', { ...json, cookie: adaCookie })
  assert.deepEqual(JSON.parse(profile.body).follows, stats)

  const cases: [string, string, Record<string, string>, number][] = [
    ['/api/follow', 'username=Ada', { cookie: adaCookie }, 400],
    ['/api/follow', 'username=nobody', { cookie: adaCookie }, 404],
    ['/api/follow', 'text=no+username', { cookie: adaCookie }, 404],
    ['/api/follow', 'username=Lars', {}, 401],
    ['/api/unfollow', 'username=Lars', {}, 401],
  ]
  for (const [path, body, headers, status] of cases) {
    const response = await request('POST', path, body, { ...json, ...headers })
    assert.equal(response.statusCode, status, `${path} ${body}`)
    assert.equal(typeof JSON.parse(response.body).error, 'string')
  }
})

test('the front page is the following feed when following more than 10 accounts', async () => {
  const cookie = await createSession('Ada')
  await createSession('Zed')
  await insertFollowees(12)
  await followFirst('Ada', 11)
  await insertBlurt('Ada', 'my own blurt', new Date())
  await insertBlurt('Zed', 'not followed', new Date())
  await insertBlurt('user12', 'also not followed', new Date())

  const home = JSON.parse((await request('GET', '/', '', { ...json, cookie })).body)
  assert.equal(home.feed, 'following')
  assert.equal(home.hasFollowingFeed, true)
  assert.deepEqual(home.followedBlurts, [])
  assert.deepEqual(
    home.blurts.map((blurt: { text: string }) => blurt.text).sort(),
    Array.from({ length: 11 }, (_, i) => `top from user${i + 1}`).sort(),
  )
  // Replies stay inline, as on the everyone feed.
  assert.deepEqual(
    home.blurts[0].replies.map((reply: { text: string }) => reply.text),
    ['reply'],
  )

  const html = await request('GET', '/', '', { cookie })
  assert.match(html.body, /<a href="\/" aria-current="page">Following<\/a>/)
  assert.match(html.body, /<a href="\/everyone">Everyone<\/a>/)
  assert.doesNotMatch(html.body, /not followed|my own blurt/)

  const everyone = JSON.parse((await request('GET', '/everyone', '', { ...json, cookie })).body)
  assert.equal(everyone.feed, 'everyone')
  assert.equal(everyone.blurts.length, 15)
  const everyoneHtml = await request('GET', '/everyone', '', { cookie })
  assert.match(everyoneHtml.body, /<a href="\/everyone" aria-current="page">Everyone<\/a>/)

  // Anonymous visitors still get the everyone feed at /.
  const anonymous = JSON.parse((await request('GET', '/', '', json)).body)
  assert.equal(anonymous.feed, 'everyone')
  assert.equal(anonymous.blurts.length, 15)
})

test('with 10 or fewer follows, the latest 5 from followed accounts top the everyone feed', async () => {
  const cookie = await createSession('Ada')
  await insertFollowees(12)
  await followFirst('Ada', 10)
  await insertBlurt('user1', 'newest from a followee', new Date(Date.now() + 60_000))
  await insertBlurt('user12', 'newest of all, not followed', new Date(Date.now() + 120_000))

  const home = JSON.parse((await request('GET', '/', '', { ...json, cookie })).body)
  assert.equal(home.feed, 'everyone')
  assert.equal(home.hasFollowingFeed, false)
  assert.equal(home.blurts.length, 14)
  assert.equal(home.followedBlurts.length, 5)
  assert.equal(home.followedBlurts[0].text, 'newest from a followee')
  for (const blurt of home.followedBlurts) {
    assert.match(blurt.username, /^user([1-9]|10)$/)
    assert.equal(blurt.parentId, null)
  }

  const html = await request('GET', '/', '', { cookie })
  assert.match(html.body, /<h2>From people you follow<\/h2>[^]*newest from a followee/)
  assert.doesNotMatch(html.body, /class="tabs"/)

  const markdown = await request('GET', '/', '', { accept: 'text/markdown', cookie })
  assert.match(markdown.body, /## From people you follow\n\n### user1\n/)

  // Not without follows, and only on the first page.
  const lars = await createSession('Lars')
  const larsHome = await request('GET', '/', '', { ...json, cookie: lars })
  assert.deepEqual(JSON.parse(larsHome.body).followedBlurts, [])
  await insertBlurts(120)
  const first = JSON.parse((await request('GET', '/', '', { ...json, cookie })).body)
  const second = JSON.parse(
    (await request('GET', `/?before=${first.next}`, '', { ...json, cookie })).body,
  )
  assert.equal(first.followedBlurts.length, 5)
  assert.deepEqual(second.followedBlurts, [])
})

// A discovery section as { kind, after, texts }, for comparing.
function discoveryTexts(discovery: { kind: string; after: number; blurts: { text: string }[] }[]) {
  return discovery.map(({ kind, after, blurts }) => ({
    kind,
    after,
    texts: blurts.map((blurt) => blurt.text).sort(),
  }))
}

test('a "you might like" section shows blurts close to what the viewer blurts', async () => {
  const cookie = await createSession('Lars')
  await createSession('Ada')
  await insertFollowees(12)
  await followFirst('Lars', 11)
  await insertBlurt('user1', 'a followed cat', new Date())
  await insertBlurt('user12', 'an unfollowed dog', new Date())
  await insertBlurt('Ada', 'cat videos all day', new Date())
  await insertBlurt('Ada', 'stock market news', new Date())
  await request('POST', '/api/blurts', 'text=my+cat+is+great', { cookie })
  const id = await blurtIdByText('my cat is great')
  await request('POST', '/api/blurts', `parentId=${id}&text=my+cat+again`, { cookie })
  await embedPendingBlurts()

  // Not their own, not from accounts they follow, nothing unrelated. One section at the
  // end of a page shorter than 20 blurts.
  const home = JSON.parse((await request('GET', '/', '', { ...json, cookie })).body)
  assert.equal(home.feed, 'following')
  assert.equal(home.blurts.length, 12)
  assert.deepEqual(discoveryTexts(home.discovery), [
    { kind: 'similar', after: 12, texts: ['cat videos all day'] },
  ])

  const html = await request('GET', '/', '', { cookie })
  assert.match(html.body, /<h2>You might like<\/h2>[^]*cat videos all day/)
  assert.doesNotMatch(html.body, /stock market news|an unfollowed dog/)

  const markdown = await request('GET', '/', '', { accept: 'text/markdown', cookie })
  assert.match(
    markdown.body,
    /## You might like\n\nClose to what you've blurted lately\.\n\n### Ada\n/,
  )

  // New users, and anyone logged out, get no section.
  const newcomer = await createSession('Newcomer')
  const newHome = JSON.parse((await request('GET', '/', '', { ...json, cookie: newcomer })).body)
  assert.deepEqual(newHome.discovery, [])
  assert.doesNotMatch((await request('GET', '/', '', { cookie: newcomer })).body, /You might like/)
  assert.deepEqual(JSON.parse((await request('GET', '/', '', json)).body).discovery, [])
})

test('discovery comes after every 20 blurts, on the first page only, never repeating it', async () => {
  const cookie = await createSession('Ada')
  await createSession('Lars')
  await createSession('Zed')
  await insertBlurts(120) // Lars, unrelated
  const later = new Date('2030-01-01T00:00:00Z')
  await insertBlurt('Ada', 'my cat is great', later)
  await insertBlurt('Zed', 'a cat on the page', later)
  for (let i = 1; i <= 7; i++) {
    await insertBlurt('Zed', `old cat ${i}`, new Date(Date.UTC(2020, 0, i)))
  }
  await embedPendingBlurts()

  const first = JSON.parse((await request('GET', '/', '', { ...json, cookie })).body)
  assert.equal(first.blurts.length, 100)
  const sections = discoveryTexts(first.discovery)
  assert.deepEqual(
    sections.map(({ kind, after, texts }) => [kind, after, texts.length]),
    [
      ['similar', 20, 3],
      ['similar', 40, 3],
      ['similar', 60, 1],
    ],
  )
  assert.deepEqual(
    sections.flatMap((section) => section.texts).sort(),
    Array.from({ length: 7 }, (_, i) => `old cat ${i + 1}`),
  )

  // In the HTML, between the 20th and 21st blurt.
  const html = (await request('GET', '/', '', { cookie })).body
  const section = html.indexOf('<h2>You might like</h2>')
  assert.ok(html.indexOf(`>${first.blurts[19].text}<`) < section)
  assert.ok(section < html.indexOf(`>${first.blurts[20].text}<`))

  const second = JSON.parse(
    (await request('GET', `/?before=${first.next}`, '', { ...json, cookie })).body,
  )
  assert.deepEqual(second.discovery, [])
})

// Puts the user's profile location straight in the database (already a cell centre).
async function placeAt(username: string, lat: number, lon: number): Promise<void> {
  await db().query(
    `UPDATE user_profiles p SET location = ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography
     FROM users u WHERE u.id = p.user_id AND u.username = $1`,
    [username, lat, lon],
  )
}

// The stored location as WKT, e.g. 'POINT(10.5 59.5)' (longitude first), or null.
async function storedLocation(username: string): Promise<string | null> {
  const { rows } = await db().query(
    `SELECT ST_AsText(p.location::geometry) AS point FROM user_profiles p
     JOIN users u ON u.id = p.user_id WHERE u.username = $1`,
    [username],
  )
  return rows[0].point
}

test('serves the world map at its fixed pixel size', async () => {
  const response = await request('GET', mapUrl)
  assert.equal(response.statusCode, 200)
  assert.match(response.contentType ?? '', /^image\/svg\+xml/)
  assert.match(response.body, new RegExp(`width="${mapWidth}" height="${mapHeight}"`))
})

test('sets, moves and removes a coarse location by clicking the map without JS', async () => {
  const cookie = await createSession('Lars')
  const before = await request('GET', '/Lars/edit', '', { cookie })
  assert.match(before.body, /<input type="image" name="location" src="\/static\/world-map\.svg"/)
  assert.match(before.body, /You haven't set a location\./)
  assert.doesNotMatch(before.body, /Remove my location/)

  // Pixel (381, 60) is around 59.75° N, 10.75° E: stored as the middle of its 1° cell.
  const click = await request('POST', '/api/location', 'location.x=381&location.y=60', { cookie })
  assert.equal(click.statusCode, 303)
  assert.equal(click.location, '/Lars/edit')
  assert.equal(await storedLocation('Lars'), 'POINT(10.5 59.5)')

  const after = await request('GET', '/Lars/edit', '', { cookie })
  assert.match(after.body, /Your location: <strong>59\.5° N, 10\.5° E<\/strong>/)
  assert.match(after.body, /class="map-marker"[^>]*style="left:381px;top:61px;?"/)

  const moved = await request('POST', '/api/location', 'location.x=100&location.y=300', {
    cookie,
  })
  assert.equal(moved.statusCode, 303)
  assert.equal(await storedLocation('Lars'), 'POINT(-129.5 -60.5)')
  assert.match((await request('GET', '/Lars/edit', '', { cookie })).body, /60\.5° S, 129\.5° W/)

  const removed = await request('POST', '/api/location', 'clear=1', { cookie })
  assert.equal(removed.statusCode, 303)
  assert.equal(removed.location, '/Lars/edit')
  assert.equal(await storedLocation('Lars'), null)
  assert.match((await request('GET', '/Lars/edit', '', { cookie })).body, /You haven't set/)
})

test('locations are snapped to the grid, validated, and shown only to their owner', async () => {
  const cookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')

  const precise = await sendJson('/api/location', { lat: 59.91234, lon: 10.75678 }, { cookie })
  assert.equal(precise.statusCode, 200)
  assert.deepEqual(JSON.parse(precise.body), { location: { lat: 59.5, lon: 10.5 } })

  // The fallback form for keyboards, and the edges of the world.
  const typed = await request('POST', '/api/location', 'lat=-33.8688&lon=151.2093', { cookie })
  assert.equal(typed.statusCode, 303)
  assert.equal(await storedLocation('Lars'), 'POINT(151.5 -33.5)')
  const corner = await sendJson('/api/location', { lat: 90, lon: 180 }, { cookie })
  assert.deepEqual(JSON.parse(corner.body), { location: { lat: 89.5, lon: -179.5 } })

  // A keyboard "click" on the image sends 0,0: the form comes back with the error.
  const keyboard = await request('POST', '/api/location', 'location.x=0&location.y=0', { cookie })
  assert.equal(keyboard.statusCode, 400)
  assert.match(keyboard.body, /Click a spot on the map, or enter a latitude and longitude\./)
  assert.match(keyboard.body, /<h1>Edit profile: Lars<\/h1>/)

  const invalid: [Record<string, unknown>, string][] = [
    [{ 'location.x': 720, 'location.y': 10 }, 'location'],
    [{ 'location.x': '5', 'location.y': '-1' }, 'location'],
    [{ 'location.x': '1.5', 'location.y': '10' }, 'location'],
    [{ lat: 91, lon: 0 }, 'lat'],
    [{ lat: '', lon: 0 }, 'lat'],
    [{ lat: 0, lon: 'east' }, 'lon'],
    [{}, 'lat'],
  ]
  for (const [body, field] of invalid) {
    const response = await sendJson('/api/location', body, { cookie })
    assert.equal(response.statusCode, 400, JSON.stringify(body))
    assert.equal(JSON.parse(response.body).errors[0].field, field, JSON.stringify(body))
  }
  assert.equal(await storedLocation('Lars'), 'POINT(-179.5 89.5)')

  // The owner sees it on the edit page; nobody sees it on the profile, not even the owner.
  const edit = JSON.parse((await request('GET', '/Lars/edit', '', { ...json, cookie })).body)
  assert.deepEqual(edit.location, { lat: 89.5, lon: -179.5 })
  for (const headers of [{ cookie }, { cookie: adaCookie }, {}]) {
    const profile = await request('GET', '/Lars/', '', { ...json, ...headers })
    assert.doesNotMatch(profile.body, /location|"lat"|"lon"|89\.5/)
  }

  const cleared = await sendJson('/api/location', { clear: true }, { cookie })
  assert.deepEqual(JSON.parse(cleared.body), { location: null })
  assert.equal((await sendJson('/api/location', { lat: 1, lon: 1 })).statusCode, 401)

  // The database refuses anything but a cell centre, whatever the app does.
  await assert.rejects(
    db().query(
      `UPDATE user_profiles SET location = ST_SetSRID(ST_MakePoint(10.75, 59.91), 4326)::geography`,
    ),
    /user_profiles_location_grid/,
  )
})

test('"blurts near you" lists blurts from people within the radius, without JS', async () => {
  const cookie = await createSession('Lars')
  for (const name of ['Ada', 'Bob', 'Zed']) {
    await createSession(name)
  }
  await placeAt('Lars', 59.5, 10.5) // Oslo
  await placeAt('Ada', 59.5, 11.5) // about 56 km away
  await placeAt('Bob', 59.5, 18.5) // Stockholm, about 450 km away
  await insertBlurt('Lars', 'my own blurt', new Date())
  await insertBlurt('Ada', 'hello from next door', new Date())
  await insertBlurt('Bob', 'hello from Stockholm', new Date())
  await insertBlurt('Zed', 'hello from nowhere', new Date())

  const near = async (query: string) => {
    const response = await request('GET', `/near${query}`, '', { ...json, cookie })
    assert.equal(response.statusCode, 200, query)
    return JSON.parse(response.body)
  }
  const texts = (data: { blurts: { text: string }[] }) => data.blurts.map((blurt) => blurt.text)

  const nearby = await near('')
  assert.deepEqual(nearby.location, { lat: 59.5, lon: 10.5 })
  assert.equal(nearby.radius, 250)
  assert.deepEqual(nearby.radii, [50, 100, 250, 500, 1000, 2500])
  assert.deepEqual(texts(nearby), ['hello from next door'])
  assert.deepEqual(texts(await near('?radius=500')), [
    'hello from Stockholm',
    'hello from next door',
  ])
  assert.deepEqual(texts(await near('?radius=50')), [])

  const html = await request('GET', '/near?radius=500', '', { cookie })
  assert.match(html.body, /<form method="get" action="\/near"/)
  assert.match(html.body, /10\.5° E\. <a href="\/Lars\/edit">Change your location<\/a>/)
  assert.match(html.body, /<option value="500" selected>500 km<\/option>/)
  assert.match(html.body, /hello from Stockholm/)
  assert.doesNotMatch(html.body, /hello from nowhere|my own blurt/)

  const markdown = await request('GET', '/near', '', { accept: 'text/markdown', cookie })
  assert.match(markdown.body, /^# Blurts near you\n[^]*within 250 km of 59\\?\.5° N, 10\.5° E/)
  assert.match(markdown.body, /### Ada\n/)

  assert.equal((await request('GET', '/near?radius=7', '', { cookie })).statusCode, 400)
  assert.equal((await request('GET', '/near?radius=abc', '', json)).statusCode, 401)
  assert.equal((await request('GET', '/near', '', json)).statusCode, 401)

  // Without a location there is nothing to be near.
  const zedCookie = (
    await request('POST', '/login', 'username=Zed&password=correct-horse')
  ).setCookie?.[0]?.split(';', 1)[0]
  const zed = await request('GET', '/near', '', { cookie: zedCookie ?? '' })
  assert.match(zed.body, /You haven't set a location\. <a href="\/Zed\/edit">/)

  // Paging keeps the radius, as a plain link.
  await db().query(
    `INSERT INTO blurts (user_id, text, created_at)
     SELECT u.id, 'old ' || i, timestamptz '2020-01-01' + i * interval '1 minute'
     FROM users u, generate_series(1, 100) AS i WHERE u.username = 'Ada'`,
  )
  const first = await near('?radius=100')
  assert.equal(first.blurts.length, 100)
  const page = await request('GET', '/near?radius=100', '', { cookie })
  assert.match(page.body, /<a href="\/near\?radius=100&amp;before=[^"]+" rel="next">Older blurts/)
  assert.deepEqual(texts(await near(`?radius=100&before=${first.next}`)), ['old 1'])
})

test('a "near you" discovery section takes turns with "you might like", never repeating a blurt', async () => {
  const cookie = await createSession('Ada')
  for (const name of ['Lars', 'Zed', 'Bob', 'Far']) {
    await createSession(name)
  }
  await insertBlurts(120) // Lars, unrelated, no location
  await insertBlurt('Ada', 'my cat is great', new Date('2030-01-01T00:00:00Z'))
  await insertBlurt('Zed', 'old cat', new Date('2020-01-02T00:00:00Z')) // similar and near
  await insertBlurt('Bob', 'old news nearby', new Date('2020-01-01T00:00:00Z'))
  await insertBlurt('Far', 'old news far away', new Date('2020-01-03T00:00:00Z'))
  await placeAt('Ada', 59.5, 10.5)
  await placeAt('Zed', 59.5, 10.5)
  await placeAt('Bob', 60.5, 10.5)
  await placeAt('Far', -33.5, 151.5)
  await embedPendingBlurts()

  const home = JSON.parse((await request('GET', '/', '', { ...json, cookie })).body)
  assert.deepEqual(discoveryTexts(home.discovery), [
    { kind: 'similar', after: 20, texts: ['old cat'] },
    { kind: 'nearby', after: 40, texts: ['old news nearby'] },
  ])

  const html = (await request('GET', '/', '', { cookie })).body
  assert.match(html, /<h2>Near you<\/h2>[^]*old news nearby/)
  const markdown = (await request('GET', '/', '', { accept: 'text/markdown', cookie })).body
  assert.match(markdown, /## Near you\n\nFrom people near where you are\.\n\n### Bob\n/)

  // Following them takes them out of discovery; no location, no section.
  await request('POST', '/api/follow', 'username=Bob', { cookie })
  const following = JSON.parse((await request('GET', '/', '', { ...json, cookie })).body)
  assert.deepEqual(
    following.discovery.map((section: { kind: string }) => section.kind),
    ['similar'],
  )
  await request('POST', '/api/unfollow', 'username=Bob', { cookie })
  await sendJson('/api/location', { clear: true }, { cookie })
  const nowhere = JSON.parse((await request('GET', '/', '', { ...json, cookie })).body)
  assert.deepEqual(
    nowhere.discovery.map((section: { kind: string }) => section.kind),
    ['similar'],
  )
})

// The cookies a response sets, by name. A cleared cookie is ''.
function cookiesSet(response: { setCookie?: string[] }): Record<string, string> {
  return Object.fromEntries(
    (response.setCookie ?? []).map((cookie) => {
      const [pair] = cookie.split(';', 1)
      const at = pair.indexOf('=')
      return [pair.slice(0, at), pair.slice(at + 1)]
    }),
  )
}

async function signUp(username = 'Lars'): Promise<Record<string, string>> {
  const response = await request(
    'POST',
    '/createUser',
    `username=${username}&password=correct-horse`,
  )
  assert.equal(response.statusCode, 303)
  return cookiesSet(response)
}

// The feed as JSON with only the refresh token: what a browser sends once it has dropped
// the expired access token.
function feedWithRefreshToken(refreshToken: string) {
  return request('GET', '/', '', { ...json, cookie: `refresh_token=${refreshToken}` })
}

function viewerName(response: { body: string }): string | null {
  return JSON.parse(response.body).viewer?.username ?? null
}

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

test('refuses to start in production without a strong JWT_SECRET', () => {
  const authModule = pathToFileURL(join(import.meta.dirname, 'middleware/auth.ts')).href
  const load = (secret: string) =>
    spawnSync(process.execPath, ['--input-type=module', '-e', `await import('${authModule}')`], {
      env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: secret },
      encoding: 'utf8',
    })

  for (const secret of ['', 'too-short']) {
    const result = load(secret)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /JWT_SECRET/)
  }
  assert.equal(load('x'.repeat(32)).status, 0)
})

test('sign-up is open below the soft limit, and counts every sign-up', async () => {
  const form = await request('GET', '/createUser')
  assert.match(form.body, /action="\/createUser"/)
  assert.doesNotMatch(form.body, /action="\/waitlist"/)

  await createSession('Lars')
  assert.equal(await signupCount(), 1)
})

test('a taken username releases the slot it claimed', async () => {
  // One slot left after Lars. Ada only gets it if the taken name gave it back.
  await setSignupLimits(2, 2)
  await createSession('Lars')
  const taken = await sendJson('/createUser', { username: 'lars', password: 'correct-horse' })
  assert.equal(taken.statusCode, 400)
  assert.equal(await signupCount(), 1)

  const created = await sendJson('/createUser', { username: 'Ada', password: 'correct-horse' })
  assert.equal(created.statusCode, 201)
  assert.equal(await signupCount(), 2)
})

test('at the soft limit, sign-up needs an invite', async () => {
  await setSignupLimits(1, 10)
  await createSession('Lars')

  const form = await request('GET', '/createUser')
  assert.match(form.body, /invite-only/)
  assert.match(form.body, /<input name="inviteCode"[^>]* required/)
  const data = JSON.parse((await request('GET', '/createUser', '', json)).body)
  assert.equal(data.signup, 'invite')
  const markdown = await request('GET', '/createUser', '', { accept: 'text/markdown' })
  assert.match(markdown.body, /invite-only/)

  const refused = await request('POST', '/createUser', 'username=Ada&password=correct-horse')
  assert.equal(refused.statusCode, 403)
  assert.match(refused.body, /role="alert">blurt\.trade is invite-only/)
  const refusedJson = await sendJson('/createUser', { username: 'Ada', password: 'correct-horse' })
  assert.equal(refusedJson.statusCode, 403)
  assert.match(JSON.parse(refusedJson.body).errors[0].message, /invite-only/)
  assert.equal(await getUserByUsername('Ada'), undefined)
  assert.equal(await signupCount(), 1)

  const waitlist = await request('POST', '/waitlist', 'username=Ada')
  assert.equal(waitlist.statusCode, 403)
})

test('at the hard limit, sign-up closes and the waitlist takes a username only', async () => {
  await setSignupLimits(1, 1)
  await createSession('Lars')

  const form = await request('GET', '/createUser')
  assert.match(form.body, /Sign-up is full/)
  assert.match(form.body, /action="\/waitlist"/)
  assert.doesNotMatch(form.body, /action="\/createUser"/)
  const refused = await request('POST', '/createUser', 'username=Ada&password=correct-horse')
  assert.equal(refused.statusCode, 403)
  assert.match(refused.body, /Join the waitlist instead/)
  assert.match(refused.body, /action="\/waitlist"/)

  const joined = await request('POST', '/waitlist', 'username=Ada')
  assert.equal(joined.statusCode, 303)
  assert.equal(joined.location, '/waitlist?username=Ada')
  const again = await sendJson('/waitlist', { username: 'ada' })
  assert.equal(again.statusCode, 201)
  assert.equal(JSON.parse(again.body).username, 'Ada')
  assert.equal(JSON.parse(again.body).status, 'waiting')

  const page = await request('GET', '/waitlist?username=ada')
  assert.match(page.body, /Ada is on the waitlist/)
  assert.match(page.body, /1 person waiting/)
  assert.match(page.body, /When it opens again/)
  const unknown = await request('GET', '/waitlist?username=Bob')
  assert.match(unknown.body, /Bob isn(&#39;|')t on the waitlist/)

  const taken = await sendJson('/waitlist', { username: 'LARS' })
  assert.equal(taken.statusCode, 400)
  const reserved = await sendJson('/waitlist', { username: 'login' })
  assert.equal(reserved.statusCode, 400)

  // Raising the limits reopens sign-up, and the waitlist page says so.
  await db().query('UPDATE signup_counter SET soft_limit = 10, hard_limit = 10')
  assert.match((await request('GET', '/waitlist?username=Ada')).body, /Sign-up is open again/)
  await createSession('Ada')
  const done = JSON.parse((await request('GET', '/waitlist?username=Ada', '', json)).body)
  assert.equal(done.entry.status, 'joined')
  assert.equal(done.waiting, 0)
})

test('the waitlist is closed while sign-up is open', async () => {
  const response = await sendJson('/waitlist', { username: 'Ada' })
  assert.equal(response.statusCode, 403)
  assert.match(JSON.parse(response.body).errors[0].message, /Sign-up is open/)
})

test('concurrent sign-ups never pass the hard limit', async () => {
  await setSignupLimits(5, 5)
  const responses = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      sendJson('/createUser', { username: `racer${i}`, password: 'correct-horse' }),
    ),
  )

  const statuses = responses.map((response) => response.statusCode)
  assert.equal(statuses.filter((status) => status === 201).length, 5)
  assert.equal(statuses.filter((status) => status === 403).length, 15)
  const { rows } = await db().query('SELECT count(*)::int AS count FROM users')
  assert.equal(rows[0].count, 5)
  assert.equal(await signupCount(), 5)
})

// The codes listed on the user's own profile, unused first.
async function inviteCodes(
  username: string,
  cookie: string,
): Promise<{ code: string; usedBy: string | null }[]> {
  const response = await request('GET', `/${username}/`, '', { ...json, cookie })
  return JSON.parse(response.body).inviteCodes
}

test('new users get invite codes that only they can see', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')

  const codes = await inviteCodes('Lars', larsCookie)
  assert.equal(codes.length, 3)
  for (const { code, usedBy } of codes) {
    assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$/)
    assert.equal(usedBy, null)
  }
  const own = await request('GET', '/Lars/', '', { cookie: larsCookie })
  assert.match(own.body, /Your invite codes/)
  assert.ok(own.body.includes(`href="/createUser?invite=${codes[0].code}"`))
  const markdown = await request('GET', '/Lars/', '', {
    accept: 'text/markdown',
    cookie: larsCookie,
  })
  assert.match(markdown.body, /## Your invite codes\n[^]*sign-up link/)

  for (const headers of [{ cookie: adaCookie }, {}]) {
    const other = await request('GET', '/Lars/', '', headers)
    assert.doesNotMatch(other.body, /invite codes|createUser\?invite/)
    const data = JSON.parse((await request('GET', '/Lars/', '', { ...json, ...headers })).body)
    assert.equal(data.inviteCodes, null)
  }
})

test('invite-only sign-up works end to end, and each code works once', async () => {
  await setSignupLimits(1, 10)
  const larsCookie = await createSession('Lars')
  const [{ code }, second] = await inviteCodes('Lars', larsCookie)

  // The shared link fills in the code.
  const form = await request('GET', `/createUser?invite=${code}`)
  assert.match(form.body, new RegExp(`name="inviteCode"[^>]* value="${code}"`))
  const data = JSON.parse((await request('GET', `/createUser?invite=${code}`, '', json)).body)
  assert.equal(data.inviteCode, code)
  const markdown = await request('GET', '/createUser', '', { accept: 'text/markdown' })
  assert.match(markdown.body, /invite-only[^]*`POST \/createUser`[^]*`inviteCode`/)

  // Typed in lower case with a dash still works.
  const typed = `${code.slice(0, 6)}-${code.slice(6)}`.toLowerCase()
  const created = await request(
    'POST',
    '/createUser',
    `username=Ada&password=correct-horse&inviteCode=${typed}`,
  )
  assert.equal(created.statusCode, 303)
  assert.equal(await signupCount(), 2)
  assert.match((await request('GET', '/Ada/')).body, /Invited by <a href="\/Lars\/">Lars<\/a>/)
  assert.equal(JSON.parse((await request('GET', '/Ada/', '', json)).body).invitedBy, 'Lars')
  const used = (await inviteCodes('Lars', larsCookie)).find((invite) => invite.code === code)
  assert.equal(used?.usedBy, 'Ada')
  assert.match((await request('GET', '/Lars/', '', { cookie: larsCookie })).body, /used by/)

  // Used, unknown, malformed and expired codes are refused and give the slot back.
  await db().query('UPDATE invite_codes SET expires_at = now() WHERE code = $1', [second.code])
  for (const inviteCode of [code, 'ABCDEFGHJKMN', 'nope', second.code]) {
    const refused = await sendJson('/createUser', {
      username: 'Bob',
      password: 'correct-horse',
      inviteCode,
    })
    assert.equal(refused.statusCode, 400, inviteCode)
    assert.equal(JSON.parse(refused.body).errors[0].field, 'inviteCode')
  }
  const html = await request(
    'POST',
    '/createUser',
    `username=Bob&password=correct-horse&inviteCode=${code}`,
  )
  assert.match(html.body, /role="alert">That invite code doesn(&#39;|')t exist/)
  assert.match(html.body, /value="Bob"/)
  assert.equal(await getUserByUsername('Bob'), undefined)
  assert.equal(await signupCount(), 2)
})

test('two sign-ups with the same code at the same moment: only one gets in', async () => {
  await setSignupLimits(1, 100)
  const [{ code }] = await inviteCodes('Lars', await createSession('Lars'))

  const responses = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      sendJson('/createUser', {
        username: `racer${i}`,
        password: 'correct-horse',
        inviteCode: code,
      }),
    ),
  )

  const statuses = responses.map((response) => response.statusCode)
  assert.equal(statuses.filter((status) => status === 201).length, 1)
  assert.equal(statuses.filter((status) => status === 400).length, 9)
  const { rows } = await db().query('SELECT count(*)::int AS count FROM users')
  assert.equal(rows[0].count, 2)
  assert.equal(await signupCount(), 2)
})

test('an invite code does not get past the hard limit', async () => {
  await setSignupLimits(1, 1)
  const larsCookie = await createSession('Lars')
  const [{ code }] = await inviteCodes('Lars', larsCookie)

  const refused = await sendJson('/createUser', {
    username: 'Ada',
    password: 'correct-horse',
    inviteCode: code,
  })
  assert.equal(refused.statusCode, 403)
  assert.match(JSON.parse(refused.body).errors[0].message, /waitlist/)
  assert.ok((await inviteCodes('Lars', larsCookie)).every((invite) => invite.usedBy === null))
})

test('open sign-up takes an optional invite code', async () => {
  const [{ code }] = await inviteCodes('Lars', await createSession('Lars'))
  assert.match((await request('GET', '/createUser')).body, /Invite code \(optional\)/)

  const created = await sendJson('/createUser', {
    username: 'Ada',
    password: 'correct-horse',
    inviteCode: code,
  })
  assert.equal(created.statusCode, 201)
  assert.equal(JSON.parse((await request('GET', '/Ada/', '', json)).body).invitedBy, 'Lars')
})

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

test('without DATABASE_READ_URL, reads go to the primary', () => {
  delete process.env.DATABASE_READ_URL
  assert.equal(dbRead(), db())
})

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
    replica.some((sql) => /ORDER BY b\.created_at DESC/.test(sql)),
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

const avatarForm = {
  skin: '#123abc',
  hairType: 'mohawk',
  hairColor: '#ff0000',
  eyeType: 'angry',
  eyeColor: '#fefefe',
  pupilColor: '#00ff00',
  toothType: 'buck',
  toothColor: '#eeeeee',
}

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString()
}

// Every <svg> on a page: only the elements and attributes the avatar template draws with.
function assertSafeSvgs(body: string): void {
  for (const [svg] of body.matchAll(/<svg[^]*?<\/svg>/g)) {
    assert.doesNotMatch(svg, /<script|<foreignObject|<use|<image|href|url\(|\son\w+=/i)
  }
}

test('new users get a random avatar from the palettes', async () => {
  await createSession('Lars')
  await createSession('Ada')
  for (const username of ['Lars', 'Ada']) {
    const avatar = (await getUserProfileByUsername(username))?.avatar
    assert.ok(avatar)
    assert.ok(avatarPalettes.skin.includes(avatar.skin), username)
    assert.ok(avatarPalettes.hairColor.includes(avatar.hairColor), username)
    assert.ok(avatarPalettes.eyeColor.includes(avatar.eyeColor), username)
    assert.ok(avatarPalettes.pupilColor.includes(avatar.pupilColor), username)
    assert.ok(avatarPalettes.toothColor.includes(avatar.toothColor), username)
    assert.ok(hairTypes.includes(avatar.hairType), username)
    assert.ok(eyeTypes.includes(avatar.eyeType), username)
    assert.ok(toothTypes.includes(avatar.toothType), username)
  }

  const avatars = new Set(Array.from({ length: 50 }, () => JSON.stringify(randomAvatar())))
  assert.ok(avatars.size > 40, 'random avatars differ')
})

test("blurts show the blurter's avatar, on alternating sides, talking on hover", async () => {
  const cookie = await createSession('Lars')
  await request('POST', '/api/avatar', formBody(avatarForm), { cookie })
  await request('POST', '/api/blurts', 'text=First', { cookie })
  await request('POST', '/api/blurts', 'text=Second', { cookie })

  const feed = await request('GET', '/')
  const cards = [...feed.body.matchAll(/<article class="blurt"><svg class="avatar avatar-small"/g)]
  assert.equal(cards.length, 2)
  assert.match(feed.body, /<svg [^>]*aria-hidden="true"[^>]*>/)
  assert.match(feed.body, /fill="#123abc"/)
  // Sides and the talking are pure CSS: no JS needed.
  assert.match(feed.body, /\.blurt:nth-of-type\(even\) \{\s*flex-direction: row-reverse;/)
  assert.match(feed.body, /\.avatar:hover \.avatar-top,/)
  assert.match(feed.body, /@keyframes avatar-talk/)
  assert.equal((feed.body.match(/class="avatar-top"/g) ?? []).length, 4) // 2 per avatar
  assertSafeSvgs(feed.body)

  const data = JSON.parse((await request('GET', '/', '', json)).body)
  assert.deepEqual(data.blurts[0].avatar, avatarForm)

  const profile = await request('GET', '/Lars/')
  assert.match(
    profile.body,
    /<svg class="avatar avatar-large"[^>]*role="img" aria-label="Lars's avatar"/,
  )
  const profileData = JSON.parse((await request('GET', '/Lars/', '', json)).body)
  assert.deepEqual(profileData.profile.avatar, avatarForm)
  assert.match(
    (await request('GET', '/Lars/', '', { accept: 'text/markdown' })).body,
    /- Avatar: skin #123abc, mohawk #ff0000 hair, angry #fefefe eyes with #00ff00 pupils, buck tooth \(#eeeeee\)/,
  )
})

test('edits the avatar with colour pickers and selects, without JS', async () => {
  const cookie = await createSession('Lars')
  const edit = await request('GET', '/Lars/edit', '', { cookie })
  assert.match(edit.body, /<form method="post" action="\/api\/avatar"/)
  for (const name of ['skin', 'hairColor', 'eyeColor', 'pupilColor', 'toothColor']) {
    assert.match(edit.body, new RegExp(`<input type="color" name="${name}" value="#[0-9a-f]{6}"`))
  }
  for (const name of ['hairType', 'eyeType', 'toothType']) {
    assert.match(edit.body, new RegExp(`<select name="${name}">`))
  }
  assert.match(edit.body, /<button type="submit" name="random" value="1" formnovalidate>Random</)

  const saved = await request('POST', '/api/avatar', formBody({ ...avatarForm, skin: '#ABCDEF' }), {
    cookie,
  })
  assert.equal(saved.statusCode, 303)
  assert.equal(saved.location, '/Lars/edit')
  assert.deepEqual((await getUserProfileByUsername('Lars'))?.avatar, {
    ...avatarForm,
    skin: '#abcdef',
  })
  const after = await request('GET', '/Lars/edit', '', { cookie })
  assert.match(after.body, /<input type="color" name="skin" value="#abcdef"/)
  assert.match(after.body, /<option value="mohawk" selected>Mohawk<\/option>/)

  // The Random button: the form's fields come along, but `random` wins.
  const random = await request('POST', '/api/avatar', formBody({ ...avatarForm, random: '1' }), {
    cookie,
  })
  assert.equal(random.statusCode, 303)
  assert.equal(random.location, '/Lars/edit')
  const randomized = (await getUserProfileByUsername('Lars'))?.avatar
  assert.ok(randomized && avatarPalettes.skin.includes(randomized.skin))

  const viaJson = await sendJson('/api/avatar', { random: true }, { cookie })
  assert.equal(viaJson.statusCode, 200)
  const stored = (await getUserProfileByUsername('Lars'))?.avatar
  assert.deepEqual(JSON.parse(viaJson.body).avatar, stored)

  const setJson = await sendJson('/api/avatar', avatarForm, { cookie })
  assert.equal(setJson.statusCode, 200)
  assert.deepEqual(JSON.parse(setJson.body), { avatar: avatarForm })

  const anonymous = await sendJson('/api/avatar', avatarForm)
  assert.equal(anonymous.statusCode, 401)
})

test('rejects avatar values that are not colours or known types', async () => {
  const cookie = await createSession('Lars')
  const before = (await getUserProfileByUsername('Lars'))?.avatar

  const cases: [Record<string, string>, string][] = [
    [{ skin: '"><script>alert(1)</script>' }, 'skin'],
    [{ hairColor: 'red' }, 'hairColor'],
    [{ pupilColor: 'url(https://evil.example/x)' }, 'pupilColor'],
    [{ eyeType: 'laser' }, 'eyeType'],
    [{ toothType: '<g onload=alert(1)>' }, 'toothType'],
  ]
  for (const [change, field] of cases) {
    const response = await sendJson('/api/avatar', { ...avatarForm, ...change }, { cookie })
    assert.equal(response.statusCode, 400, field)
    assert.deepEqual(
      JSON.parse(response.body).errors.map((error: { field: string }) => error.field),
      [field],
    )
  }

  const missing = await sendJson('/api/avatar', { skin: '#000000' }, { cookie })
  assert.equal(missing.statusCode, 400)

  const form = await request(
    'POST',
    '/api/avatar',
    formBody({ ...avatarForm, skin: '"><script>alert(1)</script>' }),
    { cookie },
  )
  assert.equal(form.statusCode, 400)
  assert.match(form.body, /Skin colour must be a colour like #a1b2c3/)
  assert.doesNotMatch(form.body, /<script>alert/)
  assert.deepEqual((await getUserProfileByUsername('Lars'))?.avatar, before)

  // The database refuses them too, whatever the app does.
  await assert.rejects(
    db().query(`UPDATE user_profiles SET avatar = avatar || '{"skin": "red"}'`),
    /user_profiles_avatar_valid/,
  )
  await assert.rejects(
    db().query(`UPDATE user_profiles SET avatar = avatar - 'eyeType'`),
    /user_profiles_avatar_valid/,
  )
})

test('the avatar template only draws known shapes and #rrggbb colours', () => {
  const hostile = {
    skin: '"/><script>alert(1)</script>',
    hairType: '<image href="https://evil.example/x.png"/>',
    hairColor: 'url(#x)',
    eyeType: 'onload',
    eyeColor: '#fff',
    pupilColor: 'javascript:alert(1)',
    toothType: '__proto__',
    toothColor: '#00000g',
  } as unknown as Avatar
  const svg = renderToString(h(AvatarSvg, { avatar: hostile, label: '<b>x</b>' }))
  assert.doesNotMatch(svg, /<script|<image|evil|javascript|url\(|<b>/)
  assertSafeSvgs(svg)
  for (const [, color] of svg.matchAll(/(?:fill|stroke)="([^"]*)"/g)) {
    assert.match(color, /^(#[0-9a-f]{6}|none)$/)
  }
})

// The real limits, and request.ip from X-Forwarded-For so each test can be its own client.
async function withRealRateLimits(run: () => Promise<void>): Promise<void> {
  setRateLimitScale(1)
  app.set('trust proxy', 'loopback')
  try {
    await run()
  } finally {
    app.set('trust proxy', trustProxySetting())
    setRateLimitScale(1000)
  }
}

function from(ip: string, headers: Record<string, string> = {}): Record<string, string> {
  return { 'x-forwarded-for': ip, ...headers }
}

test('hammering login from one IP gets 429s while another IP is unaffected', async () => {
  await createSession('Lars')
  await withRealRateLimits(async () => {
    const statuses: number[] = []
    for (let attempt = 0; attempt < 12; attempt++) {
      const username = `guess${attempt}` // a new username each time: only the IP limit applies
      const response = await request(
        'POST',
        '/login',
        `username=${username}&password=wrong-horse`,
        from('203.0.113.7'),
      )
      statuses.push(response.statusCode)
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(400))
    assert.deepEqual(statuses.slice(10), [429, 429])

    const limited = await request(
      'POST',
      '/login',
      'username=Lars&password=correct-horse',
      from('203.0.113.7', { accept: 'application/json' }),
    )
    assert.equal(limited.statusCode, 429)
    assert.ok(Number(limited.retryAfter) > 0, 'Retry-After is a number of seconds')
    assert.match(JSON.parse(limited.body).error, /Too many requests/)

    const html = await request('POST', '/login', 'username=Lars&password=x', from('203.0.113.7'))
    assert.equal(html.statusCode, 429)
    assert.match(html.contentType ?? '', /text\/plain/)

    const other = await request(
      'POST',
      '/login',
      'username=Lars&password=correct-horse',
      from('198.51.100.1'),
    )
    assert.equal(other.statusCode, 303)
  })
})

test('failed logins for one username are limited across IPs, but the owner is not', async () => {
  await createSession('Lars')
  await withRealRateLimits(async () => {
    // Logging in successfully over and over doesn't use up the username's budget.
    for (let attempt = 0; attempt < 6; attempt++) {
      const ok = await request(
        'POST',
        '/login',
        'username=Lars&password=correct-horse',
        from(`198.51.100.${attempt}`),
      )
      assert.equal(ok.statusCode, 303)
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const wrong = await request(
        'POST',
        '/login',
        'username=lars&password=wrong-horse',
        from(`203.0.113.${attempt}`),
      )
      assert.equal(wrong.statusCode, 400)
    }
    const limited = await request(
      'POST',
      '/login',
      'username=LARS&password=wrong-horse',
      from('203.0.113.99'),
    )
    assert.equal(limited.statusCode, 429)
    assert.ok(Number(limited.retryAfter) <= 60, 'a token comes back within a minute')
  })
})

test('sign-up is limited per IP', async () => {
  await withRealRateLimits(async () => {
    for (let index = 0; index < 5; index++) {
      const response = await request(
        'POST',
        '/createUser',
        `username=user${index}&password=correct-horse`,
        from('203.0.113.7'),
      )
      assert.equal(response.statusCode, 303)
    }
    const limited = await request(
      'POST',
      '/createUser',
      'username=user5&password=correct-horse',
      from('203.0.113.7'),
    )
    assert.equal(limited.statusCode, 429)
    const other = await request(
      'POST',
      '/createUser',
      'username=user5&password=correct-horse',
      from('198.51.100.1'),
    )
    assert.equal(other.statusCode, 303)
  })
})

test('blurt posting is limited per account, with a burst', async () => {
  const lars = await createSession('Lars')
  const ada = await createSession('Ada')
  await withRealRateLimits(async () => {
    for (let index = 0; index < 20; index++) {
      // From a different IP each time: the limit follows the account, not the address.
      const response = await request(
        'POST',
        '/api/blurts',
        `text=Blurt+${index}`,
        from(`203.0.113.${index}`, { cookie: lars }),
      )
      assert.equal(response.statusCode, 303)
    }
    const limited = await request('POST', '/api/blurts', 'text=One+more', {
      cookie: lars,
      accept: 'application/json',
    })
    assert.equal(limited.statusCode, 429)
    assert.ok(Number(limited.retryAfter) > 0)
    assert.equal(await countBlurts(), 20)

    const other = await request('POST', '/api/blurts', 'text=Ada+is+fine', { cookie: ada })
    assert.equal(other.statusCode, 303)
  })
})

test('follow and unfollow share one per-account budget', async () => {
  const lars = await createSession('Lars')
  await createSession('Ada')
  await withRealRateLimits(async () => {
    for (let index = 0; index < 60; index++) {
      const path = index % 2 === 0 ? '/api/follow' : '/api/unfollow'
      const response = await request('POST', path, 'username=Ada', { cookie: lars })
      assert.equal(response.statusCode, 303)
    }
    const limited = await request('POST', '/api/follow', 'username=Ada', { cookie: lars })
    assert.equal(limited.statusCode, 429)
  })
})

test('ordinary use never meets a limit', async () => {
  await withRealRateLimits(async () => {
    const lars = await createSession('Lars')
    await createSession('Ada')
    await createSession('Grace')
    const steps = [
      ['/login', 'username=Lars&password=wrong-horse'],
      ['/login', 'username=Lars&password=correct-horse'],
      ['/Lars/edit', 'bio=hello'],
      ['/api/avatar', 'random=1'],
      ['/api/follow', 'username=Ada'],
      ['/api/follow', 'username=Grace'],
      ['/api/unfollow', 'username=Grace'],
      ...Array.from({ length: 10 }, (_, index) => ['/api/blurts', `text=Blurt+${index}`]),
    ]
    for (const [path, body] of steps) {
      const response = await request('POST', path, body, { cookie: lars })
      assert.notEqual(response.statusCode, 429, `${path} was rate limited`)
    }
  })
})

test('a bucket refills steadily after the burst', () => {
  const start = 1_000_000
  setRateLimitScale(1)
  try {
    for (let index = 0; index < 20; index++) {
      assert.equal(take('blurt', 'refill-test', start).allowed, true)
    }
    const empty = take('blurt', 'refill-test', start)
    assert.equal(empty.allowed, false)
    // 20 per 10 minutes: one token every 30 seconds.
    assert.equal(!empty.allowed && empty.retryAfterSeconds, 30)
    assert.equal(take('blurt', 'refill-test', start + 29_000).allowed, false)
    assert.equal(take('blurt', 'refill-test', start + 30_000).allowed, true)
  } finally {
    setRateLimitScale(1000)
  }
})

test('parses limit specs, trust proxy settings and client keys', () => {
  assert.deepEqual(parseLimit('10/5m'), { burst: 10, periodSeconds: 300 })
  assert.deepEqual(parseLimit('3/1h'), { burst: 3, periodSeconds: 3600 })
  assert.equal(parseLimit('10'), undefined)
  assert.equal(parseLimit('0/1m'), undefined)
  assert.equal(trustProxySetting(undefined), false)
  assert.equal(trustProxySetting('1'), 1)
  assert.equal(trustProxySetting('loopback'), 'loopback')
  const key = (ip: string) => clientKey({ ip, socket: {} } as never)
  assert.equal(key('::ffff:203.0.113.7'), '203.0.113.7')
  assert.equal(key('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64')
  assert.equal(key('2001:db8::1'), '2001:db8:0:0::/64')
})

async function makeAdmin(username: string): Promise<void> {
  await db().query('UPDATE users SET is_admin = true WHERE username = $1', [username])
}

async function blurtRow(id: number): Promise<Record<string, unknown> | undefined> {
  const { rows } = await db().query(
    'SELECT user_id, text, embedding, deleted_at IS NOT NULL AS deleted FROM blurts WHERE id = $1',
    [id],
  )
  return rows[0]
}

test('the author deletes their blurt, without JS; nobody else can', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=Regret+this', { cookie: larsCookie })
  const id = await blurtIdByText('Regret this')

  const page = await request('GET', '/', '', { cookie: larsCookie })
  assert.match(page.body, new RegExp(`action="/api/blurts/${id}/delete"`))
  const othersView = await request('GET', '/', '', { cookie: adaCookie })
  assert.doesNotMatch(othersView.body, /\/delete"/)
  assert.match(othersView.body, /action="\/api\/report"/)

  const anonymous = await request('POST', `/api/blurts/${id}/delete`)
  assert.equal(anonymous.statusCode, 401)
  const forbidden = await request('POST', `/api/blurts/${id}/delete`, '', { cookie: adaCookie })
  assert.equal(forbidden.statusCode, 403)
  const forbiddenJson = await sendJson(`/api/blurts/${id}/delete`, {}, { cookie: adaCookie })
  assert.equal(forbiddenJson.statusCode, 403)
  assert.equal(typeof JSON.parse(forbiddenJson.body).error, 'string')
  assert.equal(await countBlurts(), 1)

  // Back to the page the form was on, when that is on this site.
  const deleted = await request('POST', `/api/blurts/${id}/delete`, '', {
    cookie: larsCookie,
    host: 'blurt.test',
    referer: 'http://blurt.test/Lars/?before=x',
  })
  assert.equal(deleted.statusCode, 303)
  assert.equal(deleted.location, '/Lars/?before=x')
  assert.equal(await countBlurts(), 0)
  assert.equal((await request('GET', `/Lars/${id}`)).statusCode, 404)
  assert.doesNotMatch((await request('GET', '/')).body, /Regret this/)

  const again = await request('POST', `/api/blurts/${id}/delete`, '', { cookie: larsCookie })
  assert.equal(again.statusCode, 404)

  // JSON callers get a 204. From its own page, or another site, a form goes to the feed.
  await request('POST', '/api/blurts', 'text=Also+this', { cookie: larsCookie })
  const second = await blurtIdByText('Also this')
  assert.equal(
    (await sendJson(`/api/blurts/${second}/delete`, {}, { cookie: larsCookie })).statusCode,
    204,
  )
  await request('POST', '/api/blurts', 'text=And+this', { cookie: larsCookie })
  const third = await blurtIdByText('And this')
  const fromOwnPage = await request('POST', `/api/blurts/${third}/delete`, '', {
    cookie: larsCookie,
    host: 'blurt.test',
    referer: `http://blurt.test/Lars/${third}`,
  })
  assert.equal(fromOwnPage.location, '/')
  for (const referer of ['http://evil.test/somewhere', 'http://blurt.test//evil.test/x']) {
    await request('POST', '/api/blurts', 'text=One+more', { cookie: larsCookie })
    const id = await blurtIdByText('One more')
    const fromElsewhere = await request('POST', `/api/blurts/${id}/delete`, '', {
      cookie: larsCookie,
      host: 'blurt.test',
      referer,
    })
    assert.equal(fromElsewhere.location, '/', referer)
  }
})

test('a deleted blurt with replies stays as a placeholder, its text and embedding gone', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=my+cat+opinion', { cookie: larsCookie })
  const id = await blurtIdByText('my cat opinion')
  await request('POST', '/api/blurts', `parentId=${id}&text=cat+reply`, { cookie: adaCookie })
  const replyId = await blurtIdByText('cat reply')
  await request('POST', '/api/report', `blurtId=${id}`, { cookie: adaCookie })
  await embedPendingBlurts()
  assert.notEqual((await blurtRow(id))?.embedding, null)

  const deleted = await request('POST', `/api/blurts/${id}/delete`, '', { cookie: larsCookie })
  assert.equal(deleted.statusCode, 303)
  assert.equal(deleted.location, '/')

  // Nothing of it is left but its place in the thread: no text, embedding, author or reports.
  assert.deepEqual(await blurtRow(id), {
    user_id: null,
    text: null,
    embedding: null,
    deleted: true,
  })
  const { rows: reports } = await db().query('SELECT * FROM reports')
  assert.deepEqual(reports, [])
  await embedPendingBlurts()
  assert.equal((await blurtRow(id))?.embedding, null)

  // The thread still reads, under the old link and under /deleted/:id.
  for (const path of [`/Lars/${id}`, `/deleted/${id}`]) {
    const page = await request('GET', path, '', { cookie: adaCookie })
    assert.equal(page.statusCode, 200, path)
    assert.match(page.body, /This blurt was deleted\./)
    assert.match(page.body, /cat reply/)
    assert.doesNotMatch(page.body, /my cat opinion/)
    assert.doesNotMatch(page.body, /name="parentId"/) // no replying to a placeholder
  }
  const data = JSON.parse((await request('GET', `/deleted/${id}`, '', json)).body)
  assert.equal(data.blurt.deleted, true)
  assert.equal(data.blurt.username, null)
  assert.equal(data.blurt.text, null)
  assert.equal(data.blurt.avatar, null)
  assert.deepEqual(
    data.replies.map((reply: { text: string }) => reply.text),
    ['cat reply'],
  )
  const markdown = await request('GET', `/deleted/${id}`, '', { accept: 'text/markdown' })
  assert.match(markdown.body, /^# Deleted blurt\n[^]*_This blurt was deleted\._[^]*cat reply/)

  const replyPage = await request('GET', `/Ada/${replyId}`)
  assert.match(replyPage.body, /In reply to[^]*This blurt was deleted\./)
  assert.match(replyPage.body, new RegExp(`href="/deleted/${id}"`))

  // Gone from the feed and the profile, and from related blurts.
  for (const path of ['/', '/Lars/', `/Ada/${replyId}`]) {
    assert.doesNotMatch((await request('GET', path)).body, /my cat opinion/, path)
  }
  const replyData = JSON.parse((await request('GET', `/Ada/${replyId}`, '', json)).body)
  assert.deepEqual(replyData.related, [])

  const reply = await request('POST', '/api/blurts', `parentId=${id}&text=late`, {
    cookie: adaCookie,
  })
  assert.equal(reply.statusCode, 404)
  const deleteAgain = await request('POST', `/api/blurts/${id}/delete`, '', { cookie: larsCookie })
  assert.equal(deleteAgain.statusCode, 404)

  // When its last reply goes, the placeholder goes too.
  const lastReply = await request('POST', `/api/blurts/${replyId}/delete`, '', {
    cookie: adaCookie,
  })
  assert.equal(lastReply.statusCode, 303)
  assert.equal(await countBlurts(), 0)
})

test('deleting a whole thread at once leaves nothing behind', async () => {
  const cookie = await createSession('Lars')
  await request('POST', '/api/blurts', 'text=top', { cookie })
  const top = await blurtIdByText('top')
  await request('POST', '/api/blurts', `parentId=${top}&text=middle`, { cookie })
  const middle = await blurtIdByText('middle')
  await request('POST', '/api/blurts', `parentId=${middle}&text=bottom`, { cookie })
  const bottom = await blurtIdByText('bottom')

  // Account deletion (025) passes all of a user's blurts at once.
  await deleteBlurts([top, middle, bottom])
  assert.equal(await countBlurts(), 0)
})

test('the database keeps deleted blurts empty, and never drops replies with their parent', async () => {
  const cookie = await createSession('Lars')
  await request('POST', '/api/blurts', 'text=parent', { cookie })
  const id = await blurtIdByText('parent')
  await request('POST', '/api/blurts', `parentId=${id}&text=child`, { cookie })

  await assert.rejects(
    db().query('UPDATE blurts SET deleted_at = now() WHERE id = $1', [id]),
    /blurts_deleted_removes_content/,
  )
  await assert.rejects(
    db().query('DELETE FROM blurts WHERE id = $1', [id]),
    /blurts_parent_id_fkey/,
  )
})

test('reports a blurt once, with an optional reason, without JS', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=Spicy+take', { cookie: larsCookie })
  const id = await blurtIdByText('Spicy take')

  const anonymous = await request('POST', '/api/report', `blurtId=${id}`)
  assert.equal(anonymous.statusCode, 401)
  const own = await request('POST', '/api/report', `blurtId=${id}`, { cookie: larsCookie })
  assert.equal(own.statusCode, 400)
  const missing = await request('POST', '/api/report', 'blurtId=999', { cookie: adaCookie })
  assert.equal(missing.statusCode, 404)
  const tooLong = await request('POST', '/api/report', `blurtId=${id}&reason=${'x'.repeat(501)}`, {
    cookie: adaCookie,
  })
  assert.equal(tooLong.statusCode, 400)
  assert.match(tooLong.body, /Reason is too long/)

  const reported = await request('POST', '/api/report', `blurtId=${id}&reason=Rude`, {
    cookie: adaCookie,
  })
  assert.equal(reported.statusCode, 303)
  assert.equal(reported.location, `/Lars/${id}`)
  const page = await request('GET', `/Lars/${id}`, '', { cookie: adaCookie })
  assert.match(page.body, /You reported this blurt\./)
  const data = await request('GET', `/Lars/${id}`, '', { ...json, cookie: adaCookie })
  assert.equal(JSON.parse(data.body).reported, true)

  const twice = await sendJson(
    '/api/report',
    { blurtId: id, reason: 'Again' },
    { cookie: adaCookie },
  )
  assert.equal(twice.statusCode, 204)
  const { rows } = await db().query('SELECT reason FROM reports')
  assert.deepEqual(rows, [{ reason: 'Rude' }])
})

test('the admin sees reported blurts and deletes or dismisses them', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  const ownerCookie = await createSession('Owner')
  await makeAdmin('Owner')
  await request('POST', '/api/blurts', 'text=Bad+blurt', { cookie: larsCookie })
  await request('POST', '/api/blurts', 'text=Fine+blurt', { cookie: larsCookie })
  const bad = await blurtIdByText('Bad blurt')
  const fine = await blurtIdByText('Fine blurt')
  await request('POST', '/api/report', `blurtId=${bad}&reason=Spam`, { cookie: adaCookie })
  await request('POST', '/api/report', `blurtId=${bad}`, { cookie: ownerCookie })
  await request('POST', '/api/report', `blurtId=${fine}&reason=Meh`, { cookie: adaCookie })

  // Only for admins.
  assert.equal((await request('GET', '/admin/reports')).statusCode, 401)
  assert.equal((await request('GET', '/admin/reports', '', { cookie: adaCookie })).statusCode, 403)
  const dismissByOther = await request('POST', '/api/admin/reports/dismiss', `blurtId=${fine}`, {
    cookie: adaCookie,
  })
  assert.equal(dismissByOther.statusCode, 403)

  const page = await request('GET', '/admin/reports', '', { cookie: ownerCookie })
  assert.equal(page.statusCode, 200)
  assert.match(page.body, /Bad blurt[^]*Ada<\/a>: Spam[^]*no reason given[^]*Fine blurt[^]*Meh/)
  assert.match(page.body, new RegExp(`action="/api/blurts/${bad}/delete"`))
  const data = await request('GET', '/admin/reports', '', { ...json, cookie: ownerCookie })
  type Entry = { blurt: { text: string }; reports: { reporter: string; reason: string }[] }
  assert.deepEqual(
    JSON.parse(data.body).reports.map((entry: Entry) => [
      entry.blurt.text,
      entry.reports.map((report) => `${report.reporter}: ${report.reason}`),
    ]),
    [
      ['Bad blurt', ['Ada: Spam', 'Owner: ']],
      ['Fine blurt', ['Ada: Meh']],
    ],
  )
  const markdown = await request('GET', '/admin/reports', '', {
    accept: 'text/markdown',
    cookie: ownerCookie,
  })
  assert.match(
    markdown.body,
    /^# Reports\n[^]*Bad blurt[^]*Spam[^]*`POST \/api\/admin\/reports\/dismiss`/,
  )

  // The admin may delete anyone's blurt; the form goes back to the reports.
  const deleted = await request('POST', `/api/blurts/${bad}/delete`, '', {
    cookie: ownerCookie,
    host: 'blurt.test',
    referer: 'http://blurt.test/admin/reports',
  })
  assert.equal(deleted.statusCode, 303)
  assert.equal(deleted.location, '/admin/reports')
  assert.equal(await blurtRow(bad), undefined)

  const dismissed = await request('POST', '/api/admin/reports/dismiss', `blurtId=${fine}`, {
    cookie: ownerCookie,
  })
  assert.equal(dismissed.statusCode, 303)
  assert.equal(dismissed.location, '/admin/reports')
  assert.notEqual(await blurtRow(fine), undefined)
  const empty = await request('GET', '/admin/reports', '', { cookie: ownerCookie })
  assert.match(empty.body, /No open reports\./)
})

test('reporting is limited per account', async () => {
  await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await insertBlurts(21)
  const { rows } = await db().query<{ id: number }>('SELECT id FROM blurts ORDER BY id')
  await withRealRateLimits(async () => {
    const statuses: number[] = []
    for (const { id } of rows) {
      const response = await request('POST', '/api/report', `blurtId=${id}`, { cookie: adaCookie })
      statuses.push(response.statusCode)
    }
    assert.deepEqual(statuses, [...Array<number>(20).fill(303), 429])
  })
})

test('rejects over-long blurts, counting characters, not bytes or UTF-16 units', async () => {
  const cookie = await createSession('Lars')
  const post = (text: unknown) => sendJson('/api/blurts', { text }, { cookie })

  const emoji = await post('😀'.repeat(280)) // 560 UTF-16 units, 1120 bytes
  assert.equal(emoji.statusCode, 201)
  const padded = await post(`  ${'x'.repeat(280)}\n `) // whitespace is trimmed first
  assert.equal(padded.statusCode, 201)
  assert.equal(JSON.parse(padded.body).text, 'x'.repeat(280))

  for (const text of ['😀'.repeat(281), 'x'.repeat(281), '   ', ['a', 'b']]) {
    const response = await post(text)
    assert.equal(response.statusCode, 400)
    assert.equal(JSON.parse(response.body).errors[0].field, 'text')
  }

  const form = await request('POST', '/api/blurts', `text=${'x'.repeat(281)}`, { cookie })
  assert.equal(form.statusCode, 400)
  assert.match(form.body, /Blurt must be at most 280 characters/)
  assert.match(form.body, /<textarea name="text" maxlength="280"/)
  assert.equal(await countBlurts(), 2)
})

test('rejects over-long and non-http(s) profile fields with the field named', async () => {
  const cookie = await createSession('Lars')
  const edit = (fields: Record<string, unknown>) => sendJson('/Lars/edit', fields, { cookie })
  const cases: [Record<string, unknown>, string][] = [
    [{ bio: 'x'.repeat(4001) }, 'bio'],
    [{ homepage: `https://example.com/${'x'.repeat(200)}` }, 'homepage'],
    [{ homepage: 'javascript:alert(1)' }, 'homepage'],
    [{ homepage: 'data:text/html,hi' }, 'homepage'],
    [{ homepage: 'http:example.com' }, 'homepage'],
    [{ x: 'x'.repeat(201) }, 'x'],
    [{ github: 'javascript:alert(1)' }, 'github'],
    [{ linkedin: 'ftp://example.com/lars' }, 'linkedin'],
    [{ youtube: { nested: true } }, 'youtube'],
  ]
  for (const [fields, field] of cases) {
    const response = await edit(fields)
    assert.equal(response.statusCode, 400, field)
    assert.equal(JSON.parse(response.body).errors[0].field, field)
  }

  const full = await edit({ bio: '😀'.repeat(4000), homepage: ' HTTPS://example.com ' })
  assert.equal(full.statusCode, 200)
  const profile = await getUserProfileByUsername('Lars')
  assert.equal(profile?.bio, '😀'.repeat(4000))
  assert.equal(profile?.homepage, 'HTTPS://example.com')
})

test('rejects over-long usernames, passwords and query parameters', async () => {
  const signUp = (username: string, password: string) =>
    sendJson('/createUser', { username, password })
  const longName = await signUp('x'.repeat(41), 'long enough')
  assert.equal(JSON.parse(longName.body).errors[0].field, 'username')
  const longPassword = await signUp('Lars', 'x'.repeat(201))
  assert.equal(longPassword.statusCode, 400)
  assert.equal(JSON.parse(longPassword.body).errors[0].field, 'password')
  const login = await sendJson('/login', { username: 'Lars', password: 'x'.repeat(201) })
  assert.equal(JSON.parse(login.body).errors[0].field, 'password')

  const cookie = await createSession('Lars')
  await insertBlurt('Lars', 'Hello world', new Date('2026-10-10T12:00:00.000Z'))
  const id = await blurtIdByText('Hello world')
  const longCursor = Buffer.from(`2026-10-10T12:00:00.000000Z_1${' '.repeat(100)}`)
  for (const [path, field] of [
    [`/waitlist?username=${'x'.repeat(41)}`, 'username'],
    [`/createUser?invite=${'x'.repeat(41)}`, 'invite'],
    [`/?before=${longCursor.toString('base64url')}`, 'before'],
    [`/Lars/?before=${'A'.repeat(5000)}`, 'before'],
    [`/Lars/${id}?after=nonsense`, 'after'],
    ['/near?radius=999999', 'radius'],
    ['/near?radius=-1', 'radius'],
  ]) {
    const response = await request('GET', path, '', { ...json, cookie })
    assert.equal(response.statusCode, 400, path.slice(0, 40))
    assert.equal(JSON.parse(response.body).field, field, path.slice(0, 40))
  }
})

test('answers an oversized body with a 413 in the usual error format', async () => {
  const cookie = await createSession('Lars')
  const message = `Request body is too large (at most ${bodyLimit})`
  const big = 'x'.repeat(65 * 1024)

  const form = await request('POST', '/api/blurts', `text=${big}`, { cookie })
  assert.equal(form.statusCode, 413)
  assert.match(form.contentType ?? '', /^text\/plain/)
  assert.equal(form.body, message)

  const asJson = await sendJson('/Lars/edit', { bio: big }, { cookie })
  assert.equal(asJson.statusCode, 413)
  assert.deepEqual(JSON.parse(asJson.body), { error: message })
  assert.equal(await countBlurts(), 0)

  // The largest real body, a full bio of 4-byte characters percent-encoded, still fits.
  const bio = encodeURIComponent('😀'.repeat(4000))
  const fullBio = await request('POST', '/Lars/edit', `bio=${bio}`, { cookie })
  assert.equal(fullBio.statusCode, 303)
})

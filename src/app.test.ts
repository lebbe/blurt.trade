import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { migrate } from '../db/migrate.ts'
import { closeDb, db } from './db.ts'
import { embedPendingBlurts, setEmbedder } from './embeddings.ts'
import { app } from './server.ts'
import { getUserByUsername, getUserProfileByUsername } from './routes/state.ts'
import { reservedUsernames } from './routes/users.ts'

// Never the dev database: every test wipes all tables.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://blurt:blurt@localhost:5433/blurt_test'

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
          headers: { 'content-type'?: string; location?: string; 'set-cookie'?: string[] }
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

test.before(() => migrate(process.env.DATABASE_URL))

test.beforeEach(async () => {
  await db().query('TRUNCATE users, user_profiles, blurts RESTART IDENTITY CASCADE')
})

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
  assert.deepEqual(JSON.parse(response.body), {
    viewer: null,
    blurts: [
      {
        id: 1,
        username: 'Lars',
        text: 'Hello world',
        createdAt: createdAt.toISOString(),
        parentId: null,
        replyCount: 0,
        replies: [],
      },
    ],
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

test('never renders a stored non-http(s) link as a href', async () => {
  await createSession('Lars')
  await db().query(`UPDATE user_profiles SET homepage = 'javascript:alert(1)'`)

  const response = await request('GET', '/Lars/', '')

  assert.doesNotMatch(response.body, /href="javascript:/)
  assert.match(response.body, /javascript:alert\(1\)/)
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
    ['/Lars/edit', (data) => assert.equal(data.profile.bio, '')],
    ['/login', (data) => assert.deepEqual(Object.keys(data), ['viewer'])],
    ['/createUser', (data) => assert.deepEqual(Object.keys(data), ['viewer'])],
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
    ['/Lars/edit', /^# Edit profile: Lars\n[^]*`POST \/Lars\/edit`/],
    ['/login', /^# Log in\n[^]*`POST \/login`/],
    ['/createUser', /^# Create a profile\n[^]*`POST \/createUser`/],
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

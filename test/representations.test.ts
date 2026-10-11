import test from 'node:test'
import assert from 'node:assert/strict'
import { blurtIdByText, createSession, json, request, sendJson } from './helpers.ts'

test('shows styled error pages for HTML and keeps plain text for non-HTML clients', async () => {
  const html404 = await request('GET', '/no/such/page/here')
  assert.equal(html404.statusCode, 404)
  assert.match(html404.contentType ?? '', /^text\/html/)
  assert.match(html404.body, /<h1>Not found<\/h1>/)
  assert.match(html404.body, /Back to blurt\.trade/)

  const text404 = await request('GET', '/no/such/page/here', '', { accept: 'text/plain' })
  assert.equal(text404.statusCode, 404)
  assert.match(text404.contentType ?? '', /^text\/plain/)
  assert.equal(text404.body, 'Not found')
})

test('serves robots.txt and sitemap.xml for crawlers', async () => {
  const robots = await request('GET', '/robots.txt')
  assert.equal(robots.statusCode, 200)
  assert.match(robots.contentType ?? '', /^text\/plain/)
  for (const path of ['/login', '/createUser', '/settings', '/api/']) {
    assert.match(robots.body, new RegExp(`Disallow: ${path.replace('/', '\\/')}`))
  }
  assert.match(robots.body, /Sitemap: https:\/\/blurt\.trade\/sitemap\.xml/)

  const sitemap = await request('GET', '/sitemap.xml')
  assert.equal(sitemap.statusCode, 200)
  assert.match(sitemap.contentType ?? '', /^application\/xml/)
  assert.match(sitemap.body, /<loc>https:\/\/blurt\.trade\/<\/loc>/)
  assert.match(sitemap.body, /<loc>https:\/\/blurt\.trade\/everyone<\/loc>/)
})

test('profile and blurt pages include share metadata and canonical links', async () => {
  const cookie = await createSession('Lars')
  await request('POST', '/api/blurts', 'text=Hello+%3Cb%3Eworld%3C%2Fb%3E+++from+++blurt', {
    cookie,
  })
  const id = await blurtIdByText('Hello <b>world</b>   from   blurt')

  const profile = await request('GET', '/Lars/')
  assert.match(profile.body, /<meta property="og:type" content="profile"\/>/)
  assert.match(profile.body, /<meta property="og:title" content="Lars on blurt\.trade"\/>/)
  assert.match(profile.body, /<link rel="canonical" href="https:\/\/blurt\.trade\/Lars\/"\/>/)
  assert.match(
    profile.body,
    /<link rel="icon" href="\/static\/favicon\.svg" type="image\/svg\+xml"\/>/,
  )

  const blurt = await request('GET', `/Lars/${id}`)
  assert.match(blurt.body, /<meta property="og:type" content="article"\/>/)
  assert.match(blurt.body, /<meta name="twitter:card" content="summary_large_image"\/>/)
  assert.match(
    blurt.body,
    /<meta property="og:title" content="Hello &lt;b>world&lt;\/b> from blurt"\/>/,
  )
  assert.match(
    blurt.body,
    new RegExp(`<link rel="canonical" href="https://blurt\\.trade/Lars/${id}"\\/>`),
  )
})

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

import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db.ts'
import { blurtIdByText, createSession, json, likeCount, request, sendJson } from './helpers.ts'

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

test('likes and unlikes from the feed, a profile and a blurt page without JS', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=Like+me', { cookie: larsCookie })
  const id = await blurtIdByText('Like me')
  const likeForm = new RegExp(
    `action="/api/like"[^>]*>\\s*<input type="hidden" name="blurtId" value="${id}"`,
  )
  const unlikeForm = new RegExp(
    `action="/api/unlike"[^>]*>\\s*<input type="hidden" name="blurtId" value="${id}"`,
  )

  // Anonymous visitors see the count, no button.
  const anonymous = await request('GET', '/')
  assert.match(anonymous.body, /0 likes/)
  assert.doesNotMatch(anonymous.body, /api\/(un)?like/)

  for (const page of ['/', '/Lars/', `/Lars/${id}`]) {
    assert.match((await request('GET', page, '', { cookie: adaCookie })).body, likeForm, page)
    const liked = await request('POST', '/api/like', `blurtId=${id}`, {
      cookie: adaCookie,
      host: 'blurt.test',
      referer: `http://blurt.test${page}`,
    })
    assert.equal(liked.statusCode, 303)
    assert.equal(liked.location, `${page}#blurt-${id}`)
    const after = await request('GET', page, '', { cookie: adaCookie })
    assert.match(after.body, unlikeForm, page)
    assert.match(after.body, new RegExp(`id="blurt-${id}"`), page)
    assert.match(after.body, /1 like</, page)
    // Liking twice does nothing.
    await request('POST', '/api/like', `blurtId=${id}`, { cookie: adaCookie })
    assert.equal(await likeCount(id), 1)

    const unliked = await request('POST', '/api/unlike', `blurtId=${id}`, { cookie: adaCookie })
    assert.equal(unliked.statusCode, 303)
    assert.equal(unliked.location, `/Lars/${id}`) // no Referer: the blurt's page
    await request('POST', '/api/unlike', `blurtId=${id}`, { cookie: adaCookie })
    assert.equal(await likeCount(id), 0)
    assert.match((await request('GET', page, '', { cookie: adaCookie })).body, likeForm, page)
  }

  // Another site's Referer is not followed.
  const elsewhere = await request('POST', '/api/like', `blurtId=${id}`, {
    cookie: larsCookie,
    host: 'blurt.test',
    referer: 'http://evil.test/x',
  })
  assert.equal(elsewhere.location, `/Lars/${id}`)
  // Your own blurt can be liked; the other viewer sees the count but not your like.
  assert.match((await request('GET', '/', '', { cookie: adaCookie })).body, likeForm)
  assert.match((await request('GET', '/', '', { cookie: larsCookie })).body, unlikeForm)
})

test('likes answer JSON callers with the count, and show in every list of blurts', async () => {
  await createSession('Lars')
  const adaCookie = await createSession('Ada')
  const bobCookie = await createSession('Bob')
  await request('POST', '/api/blurts', 'text=Top', { cookie: bobCookie })
  const top = await blurtIdByText('Top')
  await request('POST', '/api/blurts', `parentId=${top}&text=Reply`, { cookie: bobCookie })
  const reply = await blurtIdByText('Reply')

  const liked = await sendJson('/api/like', { blurtId: reply }, { cookie: adaCookie })
  assert.equal(liked.statusCode, 200)
  assert.deepEqual(JSON.parse(liked.body), { blurtId: reply, likeCount: 1, viewerLikes: true })
  const again = await sendJson('/api/like', { blurtId: String(reply) }, { cookie: adaCookie })
  assert.deepEqual(JSON.parse(again.body), { blurtId: reply, likeCount: 1, viewerLikes: true })

  const feed = JSON.parse((await request('GET', '/', '', { ...json, cookie: adaCookie })).body)
  assert.deepEqual(
    feed.blurts[0].replies.map((b: { likeCount: number; viewerLikes: boolean }) => [
      b.likeCount,
      b.viewerLikes,
    ]),
    [[1, true]],
  )
  assert.equal(feed.blurts[0].viewerLikes, false)
  const page = JSON.parse(
    (await request('GET', `/Bob/${reply}`, '', { ...json, cookie: adaCookie })).body,
  )
  assert.equal(page.blurt.likeCount, 1)
  assert.equal(page.blurt.viewerLikes, true)
  assert.equal(page.parent.viewerLikes, false)
  const profile = JSON.parse((await request('GET', '/Bob/', '', json)).body)
  assert.deepEqual(
    profile.blurts.map((b: { likeCount: number; viewerLikes: boolean }) => [
      b.likeCount,
      b.viewerLikes,
    ]),
    [
      [1, false],
      [0, false],
    ],
  )
  const markdown = await request('GET', `/Bob/${reply}`, '', {
    accept: 'text/markdown',
    cookie: adaCookie,
  })
  assert.match(markdown.body, /1 like \(you like it\)/)
  assert.match(markdown.body, /Unlike it with `POST \/api\/unlike`/)

  const unliked = await sendJson('/api/unlike', { blurtId: reply }, { cookie: adaCookie })
  assert.deepEqual(JSON.parse(unliked.body), { blurtId: reply, likeCount: 0, viewerLikes: false })

  const cases: [string, unknown, Record<string, string>, number][] = [
    ['/api/like', { blurtId: 999 }, { cookie: adaCookie }, 404],
    ['/api/like', { blurtId: 'x' }, { cookie: adaCookie }, 404],
    ['/api/like', {}, { cookie: adaCookie }, 404],
    ['/api/unlike', { blurtId: 999 }, { cookie: adaCookie }, 404],
    ['/api/like', { blurtId: top }, {}, 401],
    ['/api/unlike', { blurtId: top }, {}, 401],
  ]
  for (const [path, body, headers, status] of cases) {
    const response = await sendJson(path, body, headers)
    assert.equal(response.statusCode, status, `${path} ${JSON.stringify(body)}`)
    assert.equal(typeof JSON.parse(response.body).error, 'string')
  }
})

test('concurrent likes of one blurt are all counted', async () => {
  const cookies = await Promise.all(
    ['Lars', 'Ada', 'Bob', 'Eve', 'Kim', 'Ola'].map((name) => createSession(name)),
  )
  await request('POST', '/api/blurts', 'text=Rush', { cookie: cookies[0] })
  const id = await blurtIdByText('Rush')

  // Two at once, then everyone at once, each twice (liking twice changes nothing).
  await Promise.all(
    cookies.slice(0, 2).map((cookie) => sendJson('/api/like', { blurtId: id }, { cookie })),
  )
  assert.equal(await likeCount(id), 2)
  await Promise.all(
    [...cookies, ...cookies].map((cookie) => sendJson('/api/like', { blurtId: id }, { cookie })),
  )
  assert.equal(await likeCount(id), 6)
  await Promise.all(
    [...cookies.slice(0, 4), ...cookies.slice(0, 4)].map((cookie) =>
      sendJson('/api/unlike', { blurtId: id }, { cookie }),
    ),
  )
  assert.equal(await likeCount(id), 2)
  const { rows } = await db().query(
    'SELECT count(*)::int AS count FROM likes WHERE blurt_id = $1',
    [id],
  )
  assert.equal(rows[0].count, 2)
})

test('deleting a blurt deletes its likes; placeholders cannot be liked', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')
  await request('POST', '/api/blurts', 'text=Short+lived', { cookie: larsCookie })
  const gone = await blurtIdByText('Short lived')
  await request('POST', '/api/blurts', 'text=Has+replies', { cookie: larsCookie })
  const kept = await blurtIdByText('Has replies')
  await request('POST', '/api/blurts', `parentId=${kept}&text=Answer`, { cookie: adaCookie })
  for (const id of [gone, kept]) {
    await request('POST', '/api/like', `blurtId=${id}`, { cookie: adaCookie })
  }

  await request('POST', `/api/blurts/${gone}/delete`, '', { cookie: larsCookie })
  await request('POST', `/api/blurts/${kept}/delete`, '', { cookie: larsCookie })
  assert.equal((await db().query('SELECT 1 FROM likes')).rowCount, 0)
  assert.equal(await likeCount(kept), 0)

  const placeholder = await request('GET', `/deleted/${kept}`, '', { cookie: adaCookie })
  assert.doesNotMatch(placeholder.body, new RegExp(`name="blurtId" value="${kept}"`))
  for (const id of [gone, kept]) {
    const response = await sendJson('/api/like', { blurtId: id }, { cookie: adaCookie })
    assert.equal(response.statusCode, 404)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { getUserProfileByUsername } from '../src/routes/state.ts'
import {
  blurtIdByText,
  createSession,
  followFirst,
  insertBlurt,
  insertBlurts,
  insertFollowees,
  json,
  request,
} from './helpers.ts'

test('shows the empty feed', async () => {
  const response = await request('GET', '/')

  assert.equal(response.statusCode, 200)
  assert.match(response.body, /Nothing has been blurted yet/)
  assert.doesNotMatch(response.body, /action="\/api\/blurts"/)
  assert.match(response.body, /href="\/login"/)
  assert.match(response.body, /href="\/signup"/)
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
        parentUsername: null,
        replyCount: 0,
        deleted: false,
        likeCount: 0,
        viewerLikes: false,
        reblurtCount: 0,
        viewerReblurted: false,
        reblurtedBy: null,
        quoted: null,
        picture: null,
        replies: [],
      },
    ],
    discovery: [],
    next: null,
  })
})

test('rejects unsupported feed representations', async () => {
  const response = await request('GET', '/', '', { accept: 'application/xml' })

  assert.equal(response.statusCode, 406)
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

  const everyone = JSON.parse((await request('GET', '/everyone', '', { ...json, cookie })).body)
  assert.equal(everyone.feed, 'everyone')
  assert.deepEqual(everyone.followedBlurts, [])
  assert.equal(everyone.blurts.length, 14)
  assert.equal(everyone.blurts[0].text, 'newest of all, not followed')

  const everyoneHtml = await request('GET', '/everyone', '', { cookie })
  assert.doesNotMatch(everyoneHtml.body, /From people you follow/)
  const everyoneMarkdown = await request('GET', '/everyone', '', {
    accept: 'text/markdown',
    cookie,
  })
  assert.doesNotMatch(everyoneMarkdown.body, /From people you follow/)

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

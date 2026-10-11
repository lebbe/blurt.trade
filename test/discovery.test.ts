import test from 'node:test'
import assert from 'node:assert/strict'
import { embedPendingBlurts } from '../src/embeddings.ts'
import {
  blurtIdByText,
  createSession,
  followFirst,
  insertBlurt,
  insertBlurts,
  insertFollowees,
  json,
  placeAt,
  request,
  sendJson,
} from './helpers.ts'

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
